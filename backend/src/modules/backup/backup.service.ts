import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { TenantContextService } from "../../common/tenant/tenant-context.service";

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Export all Tenant Pharmacy data for backup covering all 16 tables
   */
  async exportPharmacyBackup() {
    const schemaName = this.tenantContext.getSchemaName();
    const tenantId = this.tenantContext.getTenantId();

    this.logger.log(`Generating full backup bundle for tenant schema: ${schemaName}`);

    // 1. Fetch Tenant Master Information
    const tenantInfo = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        governorate: true,
        district: true,
        addressDetails: true,
        phone: true,
        licenseKey: true,
        receiptHeader: true,
        receiptFooter: true,
        createdAt: true,
      },
    });

    // 2. Discover tables currently provisioned in this tenant schema
    const tableRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = $1;
    `, schemaName);
    const existingTables = new Set(tableRows.map((r: any) => r.table_name));

    // Helper: extracts table data if table exists; throws immediately if query fails!
    const extractTable = async (tableName: string, customSql?: string): Promise<any[]> => {
      if (!existingTables.has(tableName)) {
        return [];
      }
      try {
        const sql = customSql || `SELECT * FROM "${schemaName}"."${tableName}";`;
        return await this.prisma.$queryRawUnsafe(sql);
      } catch (err: any) {
        this.logger.error(`Critical error extracting table "${tableName}" from schema "${schemaName}": ${err.message}`);
        throw new Error(`فشل استخراج بيانات جدول (${tableName}) من قاعدة بيانات الصيدلية: ${err.message}`);
      }
    };

    // 3. Extract all 16 tables
    // Users: strictly omitting password_hash to prevent credential leakage and offline cracking
    const users = await extractTable("users", `
      SELECT id, name, username, role, is_active as "isActive", created_at as "createdAt"
      FROM "${schemaName}".users;
    `);

    const inventoryItems = await extractTable("inventory_items", `
      SELECT 
        ii.*,
        m.trade_name as "tradeName",
        m.scientific_name as "scientificName",
        m.barcode,
        m.dosage_form as "dosageForm",
        m.strength
      FROM "${schemaName}".inventory_items ii
      LEFT JOIN public.medicines m ON ii.medicine_id = m.id;
    `);

    const inventoryBatches = await extractTable("inventory_batches");
    const suppliers = await extractTable("suppliers");
    const purchases = await extractTable("purchases", `SELECT * FROM "${schemaName}".purchases ORDER BY created_at DESC;`);
    const purchaseItems = await extractTable("purchase_items");
    const purchaseInvoices = await extractTable("purchase_invoices", `SELECT * FROM "${schemaName}".purchase_invoices ORDER BY created_at DESC;`);
    const purchaseInvoiceItems = await extractTable("purchase_invoice_items");
    const supplierPayments = await extractTable("supplier_payments", `SELECT * FROM "${schemaName}".supplier_payments ORDER BY created_at DESC;`);
    const sales = await extractTable("sales", `SELECT * FROM "${schemaName}".sales ORDER BY created_at DESC;`);
    const saleItems = await extractTable("sale_items");
    const returns = await extractTable("returns", `SELECT * FROM "${schemaName}".returns ORDER BY created_at DESC;`);
    const expenses = await extractTable("expenses", `SELECT * FROM "${schemaName}".expenses ORDER BY created_at DESC;`);
    const shiftLogs = await extractTable("shift_logs", `SELECT * FROM "${schemaName}".shift_logs ORDER BY opened_at DESC;`);
    const stocktakeSessions = await extractTable("stocktake_sessions", `SELECT * FROM "${schemaName}".stocktake_sessions ORDER BY created_at DESC;`);
    const stocktakeItems = await extractTable("stocktake_items");

    const backupPayload = {
      version: "2.0",
      system: "DAWAEE_PHARMACY_BACKUP",
      exportedAt: new Date().toISOString(),
      tenant: tenantInfo,
      manifest: {
        totalTablesInSchema: existingTables.size,
        tables: Array.from(existingTables),
      },
      data: {
        users,
        inventoryItems,
        inventoryBatches,
        suppliers,
        purchases,
        purchaseItems,
        purchaseInvoices,
        purchaseInvoiceItems,
        supplierPayments,
        sales,
        saleItems,
        returns,
        expenses,
        shiftLogs,
        stocktakeSessions,
        stocktakeItems,
      },
      summary: {
        totalInventoryItems: inventoryItems.length,
        totalBatches: inventoryBatches.length,
        totalSalesInvoices: sales.length,
        totalSuppliers: suppliers.length,
        totalPurchases: purchases.length,
        totalPurchaseInvoices: purchaseInvoices.length,
        totalExpenses: expenses.length,
        totalShiftLogs: shiftLogs.length,
        totalStocktakeSessions: stocktakeSessions.length,
      },
    };

    return backupPayload;
  }

  /**
   * Restore Pharmacy data from a valid Backup payload
   */
  async restorePharmacyBackup(payload: any) {
    if (!payload || payload.system !== "DAWAEE_PHARMACY_BACKUP" || !payload.data) {
      throw new BadRequestException("ملف النسخة الاحتياطية غير صالح أو تالف.");
    }

    const schemaName = this.tenantContext.getSchemaName();
    this.logger.log(`Restoring backup into tenant schema: ${schemaName}`);

    const {
      inventoryItems,
      inventoryBatches,
      suppliers,
      purchases,
      purchaseItems,
      purchaseInvoices,
      purchaseInvoiceItems,
      supplierPayments,
      expenses,
    } = payload.data;

    // Transactional restore
    await this.prisma.$transaction(async (tx) => {
      // 1. Restore Inventory Items & Batches
      if (Array.isArray(inventoryItems) && inventoryItems.length > 0) {
        for (const item of inventoryItems) {
          await tx.$executeRawUnsafe(`
            INSERT INTO "${schemaName}".inventory_items (id, medicine_id, units_per_pack, selling_price_pack, selling_price_unit, min_alert_units, custom_name, shelf_location)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
              units_per_pack = EXCLUDED.units_per_pack,
              selling_price_pack = EXCLUDED.selling_price_pack,
              selling_price_unit = EXCLUDED.selling_price_unit,
              min_alert_units = EXCLUDED.min_alert_units,
              custom_name = EXCLUDED.custom_name,
              shelf_location = EXCLUDED.shelf_location;
          `, item.id, item.medicine_id || item.medicineId, item.units_per_pack || item.unitsPerPack || 1, item.selling_price_pack || item.sellingPricePack, item.selling_price_unit || item.sellingPriceUnit, item.min_alert_units || item.minAlertUnits || 5, item.custom_name || item.customName || null, item.shelf_location || item.shelfLocation || null);
        }
      }

      if (Array.isArray(inventoryBatches) && inventoryBatches.length > 0) {
        for (const b of inventoryBatches) {
          await tx.$executeRawUnsafe(`
            INSERT INTO "${schemaName}".inventory_batches (id, inventory_item_id, batch_number, purchase_price_pack, quantity_units_remaining, expiry_date)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::date)
            ON CONFLICT (id) DO UPDATE SET
              quantity_units_remaining = EXCLUDED.quantity_units_remaining,
              purchase_price_pack = EXCLUDED.purchase_price_pack,
              expiry_date = EXCLUDED.expiry_date;
          `, b.id, b.inventory_item_id || b.inventoryItemId, b.batch_number || b.batchNumber, b.purchase_price_pack || b.purchasePricePack, b.quantity_units_remaining || b.quantityUnitsRemaining, b.expiry_date || b.expiryDate);
        }
      }

      // 2. Restore Suppliers & Debts if present
      if (Array.isArray(suppliers) && suppliers.length > 0) {
        for (const s of suppliers) {
          await tx.$executeRawUnsafe(`
            INSERT INTO "${schemaName}".suppliers (id, name, phone, address, company_name, balance_due, notes)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
              phone = EXCLUDED.phone,
              address = EXCLUDED.address,
              company_name = EXCLUDED.company_name,
              balance_due = EXCLUDED.balance_due;
          `, s.id, s.name, s.phone || null, s.address || null, s.company_name || s.companyName || null, s.balance_due || s.balanceDue || 0, s.notes || null);
        }
      }

      // 3. Restore Expenses
      if (Array.isArray(expenses) && expenses.length > 0) {
        for (const exp of expenses) {
          await tx.$executeRawUnsafe(`
            INSERT INTO "${schemaName}".expenses (id, category, title, amount, expense_date, recipient, notes)
            VALUES ($1::uuid, $2, $3, $4, $5::timestamp, $6, $7)
            ON CONFLICT (id) DO NOTHING;
          `, exp.id, exp.category || 'OTHER', exp.title, exp.amount, exp.expense_date || exp.expenseDate || new Date(), exp.recipient || null, exp.notes || null);
        }
      }
    });

    return {
      success: true,
      message: "تمت استعادة البيانات بنجاح",
      restoredItems: (inventoryItems || []).length,
      restoredBatches: (inventoryBatches || []).length,
      restoredSuppliers: (suppliers || []).length,
      restoredExpenses: (expenses || []).length,
    };
  }
}
