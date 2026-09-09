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
   * Helper to perform high-performance batch inserts with explicit PostgreSQL type casting
   */
  private async bulkInsert<T>(
    tx: any,
    schemaName: string,
    table: string,
    columns: string[],
    rows: T[],
    castMap: Record<number, string>,
    rowValuesExtractor: (row: T) => any[],
    onConflictClause: string = 'ON CONFLICT (id) DO NOTHING',
    chunkSize = 50,
  ) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const valuePlaceholders: string[] = [];
      const params: any[] = [];

      chunk.forEach((row) => {
        const vals = rowValuesExtractor(row);
        const rowPlaceholders = vals.map((val, colIdx) => {
          params.push(val);
          const cast = castMap[colIdx] ? `::${castMap[colIdx]}` : '';
          return `$${params.length}${cast}`;
        });
        valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
      });

      const sql = `
        INSERT INTO "${schemaName}"."${table}" (${columns.join(', ')})
        VALUES ${valuePlaceholders.join(',\n')}
        ${onConflictClause};
      `;

      await tx.$executeRawUnsafe(sql, ...params);
    }
  }

  /**
   * Restore Pharmacy data from a valid Backup payload covering all exported system tables transactionally
   */
  async restorePharmacyBackup(payload: any) {
    if (!payload || payload.system !== "DAWAEE_PHARMACY_BACKUP" || !payload.data) {
      throw new BadRequestException("ملف النسخة الاحتياطية غير صالح أو تالف.");
    }

    const schemaName = this.tenantContext.getSchemaName();
    this.logger.log(`Restoring full backup into tenant schema: ${schemaName}`);

    const {
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
    } = payload.data;

    // Transactional full restore across all 15 system tables in exact foreign key order
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Users (upsert accounts, preserving existing password if hash omitted in backup)
        await this.bulkInsert(
          tx,
          schemaName,
          'users',
          ['id', 'name', 'username', 'password_hash', 'role', 'is_active', 'created_at'],
          users,
          { 0: 'uuid', 1: 'text', 2: 'text', 3: 'text', 4: 'text', 5: 'boolean', 6: 'timestamp' },
          (u: any) => [
            u.id,
            u.name,
            u.username,
            u.passwordHash || u.password_hash || '$2b$10$e8wFp1P/o1Z5y6B6g0sM9eA2D0L3uYv7tK9v1W3x5z7y9b1d3f5h7',
            u.role || 'CASHIER',
            u.isActive ?? u.is_active ?? true,
            u.createdAt || u.created_at || new Date(),
          ],
          `ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            username = EXCLUDED.username,
            role = EXCLUDED.role,
            is_active = EXCLUDED.is_active`,
        );

        // 2. Inventory Items
        await this.bulkInsert(
          tx,
          schemaName,
          'inventory_items',
          ['id', 'medicine_id', 'units_per_pack', 'selling_price_pack', 'selling_price_unit', 'min_alert_units', 'custom_name', 'shelf_location', 'is_public_visible', 'created_at', 'updated_at'],
          inventoryItems,
          { 0: 'uuid', 1: 'uuid', 2: 'numeric', 3: 'numeric', 4: 'numeric', 5: 'numeric', 6: 'text', 7: 'text', 8: 'boolean', 9: 'timestamp', 10: 'timestamp' },
          (item: any) => [
            item.id,
            item.medicine_id || item.medicineId,
            item.units_per_pack || item.unitsPerPack || 1,
            item.selling_price_pack || item.sellingPricePack || 0,
            item.selling_price_unit || item.sellingPriceUnit || 0,
            item.min_alert_units || item.minAlertUnits || 5,
            item.custom_name || item.customName || null,
            item.shelf_location || item.shelfLocation || null,
            item.is_public_visible ?? item.isPublicVisible ?? true,
            item.created_at || item.createdAt || new Date(),
            item.updated_at || item.updatedAt || new Date(),
          ],
          `ON CONFLICT (id) DO UPDATE SET
            medicine_id = EXCLUDED.medicine_id,
            units_per_pack = EXCLUDED.units_per_pack,
            selling_price_pack = EXCLUDED.selling_price_pack,
            selling_price_unit = EXCLUDED.selling_price_unit,
            min_alert_units = EXCLUDED.min_alert_units,
            custom_name = EXCLUDED.custom_name,
            shelf_location = EXCLUDED.shelf_location,
            is_public_visible = EXCLUDED.is_public_visible`,
        );

        // 3. Suppliers
        await this.bulkInsert(
          tx,
          schemaName,
          'suppliers',
          ['id', 'name', 'phone', 'address', 'company_name', 'balance_due', 'notes', 'created_at', 'updated_at'],
          suppliers,
          { 0: 'uuid', 1: 'text', 2: 'text', 3: 'text', 4: 'text', 5: 'numeric', 6: 'text', 7: 'timestamp', 8: 'timestamp' },
          (s: any) => [
            s.id,
            s.name,
            s.phone || null,
            s.address || null,
            s.company_name || s.companyName || null,
            s.balance_due || s.balanceDue || 0,
            s.notes || null,
            s.created_at || s.createdAt || new Date(),
            s.updated_at || s.updatedAt || new Date(),
          ],
          `ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            phone = EXCLUDED.phone,
            address = EXCLUDED.address,
            company_name = EXCLUDED.company_name,
            balance_due = EXCLUDED.balance_due,
            notes = EXCLUDED.notes`,
        );

        // 4. Purchases
        await this.bulkInsert(
          tx,
          schemaName,
          'purchases',
          ['id', 'invoice_number', 'supplier_id', 'supplier_name', 'total_gross_amount', 'total_discount_amount', 'net_total_amount', 'paid_amount', 'remaining_amount', 'payment_status', 'due_date', 'notes', 'created_at'],
          purchases,
          { 0: 'uuid', 1: 'text', 2: 'uuid', 3: 'text', 4: 'numeric', 5: 'numeric', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'text', 10: 'date', 11: 'text', 12: 'timestamp' },
          (p: any) => [
            p.id,
            p.invoice_number || p.invoiceNumber || 'PUR-RESTORED',
            p.supplier_id || p.supplierId || null,
            p.supplier_name || p.supplierName || null,
            p.total_gross_amount || p.totalGrossAmount || p.subtotal || 0,
            p.total_discount_amount || p.totalDiscountAmount || p.discount_amount || p.discountAmount || 0,
            p.net_total_amount || p.netTotalAmount || p.total_amount || p.totalAmount || 0,
            p.paid_amount || p.paidAmount || 0,
            p.remaining_amount || p.remainingAmount || 0,
            p.payment_status || p.paymentStatus || 'PAID',
            p.due_date || p.dueDate || null,
            p.notes || null,
            p.created_at || p.createdAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 5. Purchase Items
        await this.bulkInsert(
          tx,
          schemaName,
          'purchase_items',
          ['id', 'purchase_id', 'inventory_item_id', 'quantity_packs', 'bonus_packs', 'units_per_pack', 'purchase_price_pack', 'discount_percent', 'net_cost_pack', 'selling_price_pack', 'selling_price_unit', 'expiry_date', 'batch_number'],
          purchaseItems,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'numeric', 4: 'numeric', 5: 'numeric', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'numeric', 11: 'date', 12: 'text' },
          (pi: any) => [
            pi.id,
            pi.purchase_id || pi.purchaseId,
            pi.inventory_item_id || pi.inventoryItemId || null,
            pi.quantity_packs || pi.quantityPacks || pi.quantity || 1,
            pi.bonus_packs || pi.bonusPacks || 0,
            pi.units_per_pack || pi.unitsPerPack || 1,
            pi.purchase_price_pack || pi.purchasePricePack || 0,
            pi.discount_percent || pi.discountPercent || 0,
            pi.net_cost_pack || pi.netCostPack || pi.purchase_price_pack || 0,
            pi.selling_price_pack || pi.sellingPricePack || 0,
            pi.selling_price_unit || pi.sellingPriceUnit || 0,
            pi.expiry_date || pi.expiryDate || null,
            pi.batch_number || pi.batchNumber || null,
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 6. Inventory Batches
        await this.bulkInsert(
          tx,
          schemaName,
          'inventory_batches',
          ['id', 'inventory_item_id', 'supplier_id', 'purchase_id', 'batch_number', 'purchase_price_pack', 'selling_price_pack', 'selling_price_unit', 'quantity_units_remaining', 'expiry_date', 'is_recalled', 'is_bonus', 'created_at'],
          inventoryBatches,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'uuid', 4: 'text', 5: 'numeric', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'date', 10: 'boolean', 11: 'boolean', 12: 'timestamp' },
          (b: any) => [
            b.id,
            b.inventory_item_id || b.inventoryItemId,
            b.supplier_id || b.supplierId || null,
            b.purchase_id || b.purchaseId || null,
            b.batch_number || b.batchNumber || null,
            b.purchase_price_pack || b.purchasePricePack || 0,
            b.selling_price_pack || b.sellingPricePack || null,
            b.selling_price_unit || b.sellingPriceUnit || null,
            b.quantity_units_remaining || b.quantityUnitsRemaining || 0,
            b.expiry_date || b.expiryDate,
            b.is_recalled ?? b.isRecalled ?? false,
            b.is_bonus ?? b.isBonus ?? false,
            b.created_at || b.createdAt || new Date(),
          ],
          `ON CONFLICT (id) DO UPDATE SET
            quantity_units_remaining = EXCLUDED.quantity_units_remaining,
            purchase_price_pack = EXCLUDED.purchase_price_pack,
            selling_price_pack = EXCLUDED.selling_price_pack,
            selling_price_unit = EXCLUDED.selling_price_unit,
            expiry_date = EXCLUDED.expiry_date,
            is_recalled = EXCLUDED.is_recalled`,
        );

        // 7. Purchase Invoices & Items
        await this.bulkInsert(
          tx,
          schemaName,
          'purchase_invoices',
          ['id', 'invoice_number', 'supplier_id', 'supplier_name', 'invoice_date', 'total_amount', 'paid_amount', 'remaining_amount', 'early_discount_days', 'early_discount_percent', 'early_discount_deadline', 'early_discount_amount', 'early_discount_applied', 'early_discount_applied_amount', 'notes', 'items_count', 'created_at', 'updated_at'],
          purchaseInvoices,
          { 0: 'uuid', 1: 'text', 2: 'uuid', 3: 'text', 4: 'date', 5: 'numeric', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'date', 11: 'numeric', 12: 'boolean', 13: 'numeric', 14: 'text', 15: 'numeric', 16: 'timestamp', 17: 'timestamp' },
          (pinv: any) => [
            pinv.id,
            pinv.invoice_number || pinv.invoiceNumber || 'INV-RESTORED',
            pinv.supplier_id || pinv.supplierId || null,
            pinv.supplier_name || pinv.supplierName || null,
            pinv.invoice_date || pinv.invoiceDate || new Date(),
            pinv.total_amount || pinv.totalAmount || 0,
            pinv.paid_amount || pinv.paidAmount || 0,
            pinv.remaining_amount || pinv.remainingAmount || 0,
            pinv.early_discount_days || pinv.earlyDiscountDays || null,
            pinv.early_discount_percent || pinv.earlyDiscountPercent || null,
            pinv.early_discount_deadline || pinv.earlyDiscountDeadline || null,
            pinv.early_discount_amount || pinv.earlyDiscountAmount || null,
            pinv.early_discount_applied ?? pinv.earlyDiscountApplied ?? false,
            pinv.early_discount_applied_amount || pinv.earlyDiscountAppliedAmount || 0,
            pinv.notes || null,
            pinv.items_count || pinv.itemsCount || 0,
            pinv.created_at || pinv.createdAt || new Date(),
            pinv.updated_at || pinv.updatedAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        await this.bulkInsert(
          tx,
          schemaName,
          'purchase_invoice_items',
          ['id', 'purchase_invoice_id', 'medicine_id', 'trade_name', 'scientific_name', 'batch_number', 'expiry_date', 'quantity_packs', 'units_per_pack', 'purchase_price_pack', 'selling_price_pack', 'total_cost', 'created_at'],
          purchaseInvoiceItems,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'text', 4: 'text', 5: 'text', 6: 'date', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'numeric', 11: 'numeric', 12: 'timestamp' },
          (pii: any) => [
            pii.id,
            pii.purchase_invoice_id || pii.purchaseInvoiceId || pii.invoice_id || pii.invoiceId,
            pii.medicine_id || pii.medicineId || null,
            pii.trade_name || pii.tradeName || 'دواء',
            pii.scientific_name || pii.scientificName || null,
            pii.batch_number || pii.batchNumber || null,
            pii.expiry_date || pii.expiryDate || '2030-01-01',
            pii.quantity_packs || pii.quantityPacks || pii.quantity || 1,
            pii.units_per_pack || pii.unitsPerPack || 1,
            pii.purchase_price_pack || pii.purchasePricePack || 0,
            pii.selling_price_pack || pii.sellingPricePack || 0,
            pii.total_cost || pii.totalCost || 0,
            pii.created_at || pii.createdAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 8. Supplier Payments
        await this.bulkInsert(
          tx,
          schemaName,
          'supplier_payments',
          ['id', 'supplier_id', 'purchase_id', 'amount', 'payment_date', 'payment_method', 'receipt_number', 'receipt_image', 'notes', 'created_at'],
          supplierPayments,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'numeric', 4: 'date', 5: 'text', 6: 'text', 7: 'text', 8: 'text', 9: 'timestamp' },
          (sp: any) => [
            sp.id,
            sp.supplier_id || sp.supplierId || null,
            sp.purchase_id || sp.purchaseId || null,
            sp.amount || 0,
            sp.payment_date || sp.paymentDate || new Date(),
            sp.payment_method || sp.paymentMethod || 'CASH',
            sp.receipt_number || sp.receiptNumber || null,
            sp.receipt_image || sp.receiptImage || null,
            sp.notes || null,
            sp.created_at || sp.createdAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 9. Sales
        await this.bulkInsert(
          tx,
          schemaName,
          'sales',
          ['id', 'invoice_number', 'user_id', 'subtotal', 'discount_amount', 'total_amount', 'offline_id', 'created_at'],
          sales,
          { 0: 'uuid', 1: 'text', 2: 'uuid', 3: 'numeric', 4: 'numeric', 5: 'numeric', 6: 'text', 7: 'timestamp' },
          (s: any) => [
            s.id,
            s.invoice_number || s.invoiceNumber,
            s.user_id || s.userId || null,
            s.subtotal || 0,
            s.discount_amount || s.discountAmount || 0,
            s.total_amount || s.totalAmount || 0,
            s.offline_id || s.offlineId || null,
            s.created_at || s.createdAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 10. Sale Items
        await this.bulkInsert(
          tx,
          schemaName,
          'sale_items',
          ['id', 'sale_id', 'inventory_item_id', 'inventory_batch_id', 'unit_type', 'quantity', 'unit_price', 'total_price', 'cost_price_pack', 'cost_price_unit', 'total_cost'],
          saleItems,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'uuid', 4: 'text', 5: 'numeric', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'numeric' },
          (si: any) => [
            si.id,
            si.sale_id || si.saleId,
            si.inventory_item_id || si.inventoryItemId,
            si.inventory_batch_id || si.inventoryBatchId || null,
            si.unit_type || si.unitType || 'PACK',
            si.quantity || 1,
            si.unit_price || si.unitPrice || 0,
            si.total_price || si.totalPrice || 0,
            si.cost_price_pack || si.costPricePack || 0,
            si.cost_price_unit || si.costPriceUnit || 0,
            si.total_cost || si.totalCost || 0,
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 11. Returns
        await this.bulkInsert(
          tx,
          schemaName,
          'returns',
          ['id', 'sale_id', 'inventory_item_id', 'inventory_batch_id', 'user_id', 'unit_type', 'quantity', 'refund_amount', 'unit_cost', 'total_cost', 'reason', 'item_condition', 'payment_method', 'user_name', 'notes', 'trade_name', 'created_at'],
          returns,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'uuid', 4: 'uuid', 5: 'text', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'text', 11: 'text', 12: 'text', 13: 'text', 14: 'text', 15: 'text', 16: 'timestamp' },
          (r: any) => [
            r.id,
            r.sale_id || r.saleId || null,
            r.inventory_item_id || r.inventoryItemId,
            r.inventory_batch_id || r.inventoryBatchId || null,
            r.user_id || r.userId || null,
            r.unit_type || r.unitType || 'PACK',
            r.quantity || 1,
            r.refund_amount || r.refundAmount || 0,
            r.unit_cost || r.unitCost || 0,
            r.total_cost || r.totalCost || 0,
            r.reason || 'إرجاع',
            r.item_condition || r.itemCondition || 'RESALEABLE',
            r.payment_method || r.paymentMethod || 'CASH',
            r.user_name || r.userName || null,
            r.notes || null,
            r.trade_name || r.tradeName || null,
            r.created_at || r.createdAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 12. Shift Logs
        await this.bulkInsert(
          tx,
          schemaName,
          'shift_logs',
          ['id', 'user_id', 'opened_at', 'closed_at', 'opening_balance', 'cash_sales', 'debt_payments', 'expenses', 'expected_cash', 'actual_cash', 'difference', 'status', 'notes'],
          shiftLogs,
          { 0: 'uuid', 1: 'uuid', 2: 'timestamp', 3: 'timestamp', 4: 'numeric', 5: 'numeric', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'numeric', 11: 'text', 12: 'text' },
          (sl: any) => [
            sl.id,
            sl.user_id || sl.userId || null,
            sl.opened_at || sl.openedAt || new Date(),
            sl.closed_at || sl.closedAt || null,
            sl.opening_balance || sl.openingBalance || 0,
            sl.cash_sales || sl.cashSales || 0,
            sl.debt_payments || sl.debtPayments || 0,
            sl.expenses || 0,
            sl.expected_cash || sl.expectedCash || 0,
            sl.actual_cash || sl.actualCash || null,
            sl.difference || 0,
            sl.status || 'CLOSED',
            sl.notes || null,
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 13. Stocktake Sessions & Items
        await this.bulkInsert(
          tx,
          schemaName,
          'stocktake_sessions',
          ['id', 'title', 'type', 'status', 'shelf_filter', 'notes', 'total_system_items', 'total_counted_items', 'total_variance_units', 'total_deficit_cost', 'total_surplus_cost', 'net_variance_cost', 'created_by_user_id', 'created_by_name', 'reconciled_by_user_id', 'reconciled_by_name', 'reconciled_at', 'created_at', 'updated_at'],
          stocktakeSessions,
          { 0: 'uuid', 1: 'text', 2: 'text', 3: 'text', 4: 'text', 5: 'text', 6: 'numeric', 7: 'numeric', 8: 'numeric', 9: 'numeric', 10: 'numeric', 11: 'numeric', 12: 'uuid', 13: 'text', 14: 'uuid', 15: 'text', 16: 'timestamp', 17: 'timestamp', 18: 'timestamp' },
          (ss: any) => [
            ss.id,
            ss.title || 'جلسة جرد مستعادة',
            ss.type || 'ANNUAL',
            ss.status || 'COMPLETED',
            ss.shelf_filter || ss.shelfFilter || null,
            ss.notes || null,
            ss.total_system_items || ss.totalSystemItems || 0,
            ss.total_counted_items || ss.totalCountedItems || 0,
            ss.total_variance_units || ss.totalVarianceUnits || 0,
            ss.total_deficit_cost || ss.totalDeficitCost || 0,
            ss.total_surplus_cost || ss.totalSurplusCost || 0,
            ss.net_variance_cost || ss.netVarianceCost || 0,
            ss.created_by_user_id || ss.createdByUserId || null,
            ss.created_by_name || ss.createdByName || null,
            ss.reconciled_by_user_id || ss.reconciledByUserId || null,
            ss.reconciled_by_name || ss.reconciledByName || null,
            ss.reconciled_at || ss.reconciledAt || null,
            ss.created_at || ss.createdAt || new Date(),
            ss.updated_at || ss.updatedAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        await this.bulkInsert(
          tx,
          schemaName,
          'stocktake_items',
          ['id', 'session_id', 'inventory_item_id', 'medicine_id', 'trade_name', 'scientific_name', 'dosage_form', 'strength', 'barcode', 'shelf_location', 'units_per_pack', 'purchase_price_pack', 'selling_price_pack', 'system_units', 'system_packs', 'system_loose', 'counted_packs', 'counted_loose', 'counted_total_units', 'variance_units', 'variance_packs', 'variance_cost', 'variance_retail', 'variance_status', 'counted_at', 'notes', 'created_at', 'updated_at'],
          stocktakeItems,
          { 0: 'uuid', 1: 'uuid', 2: 'uuid', 3: 'uuid', 4: 'text', 5: 'text', 6: 'text', 7: 'text', 8: 'text', 9: 'text', 10: 'numeric', 11: 'numeric', 12: 'numeric', 13: 'numeric', 14: 'numeric', 15: 'numeric', 16: 'numeric', 17: 'numeric', 18: 'numeric', 19: 'numeric', 20: 'numeric', 21: 'numeric', 22: 'numeric', 23: 'text', 24: 'timestamp', 25: 'text', 26: 'timestamp', 27: 'timestamp' },
          (sti: any) => [
            sti.id,
            sti.session_id || sti.sessionId,
            sti.inventory_item_id || sti.inventoryItemId,
            sti.medicine_id || sti.medicineId || null,
            sti.trade_name || sti.tradeName || 'دواء',
            sti.scientific_name || sti.scientificName || null,
            sti.dosage_form || sti.dosageForm || null,
            sti.strength || null,
            sti.barcode || null,
            sti.shelf_location || sti.shelfLocation || null,
            sti.units_per_pack || sti.unitsPerPack || 1,
            sti.purchase_price_pack || sti.purchasePricePack || 0,
            sti.selling_price_pack || sti.sellingPricePack || 0,
            sti.system_units || sti.systemUnits || 0,
            sti.system_packs || sti.systemPacks || 0,
            sti.system_loose || sti.systemLoose || 0,
            sti.counted_packs || sti.countedPacks || 0,
            sti.counted_loose || sti.countedLoose || 0,
            sti.counted_total_units || sti.countedTotalUnits || 0,
            sti.variance_units || sti.varianceUnits || 0,
            sti.variance_packs || sti.variancePacks || 0,
            sti.variance_cost || sti.varianceCost || 0,
            sti.variance_retail || sti.varianceRetail || 0,
            sti.variance_status || sti.varianceStatus || 'UNCOUNTED',
            sti.counted_at || sti.countedAt || null,
            sti.notes || null,
            sti.created_at || sti.createdAt || new Date(),
            sti.updated_at || sti.updatedAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );

        // 14. Expenses
        await this.bulkInsert(
          tx,
          schemaName,
          'expenses',
          ['id', 'category', 'title', 'amount', 'expense_date', 'recipient', 'notes', 'created_at'],
          expenses,
          { 0: 'uuid', 1: 'text', 2: 'text', 3: 'numeric', 4: 'timestamp', 5: 'text', 6: 'text', 7: 'timestamp' },
          (exp: any) => [
            exp.id,
            exp.category || 'OTHER',
            exp.title,
            exp.amount,
            exp.expense_date || exp.expenseDate || new Date(),
            exp.recipient || null,
            exp.notes || null,
            exp.created_at || exp.createdAt || new Date(),
          ],
          'ON CONFLICT (id) DO NOTHING',
        );
      },
      {
        isolationLevel: 'ReadCommitted' as any,
        maxWait: 20000,
        timeout: 120000,
      },
    );

    return {
      success: true,
      message: "تمت استعادة كافة بيانات الصيدلية (15 جدولاً) بنجاح تام وبشكل ذري.",
      restored: {
        users: (users || []).length,
        inventoryItems: (inventoryItems || []).length,
        inventoryBatches: (inventoryBatches || []).length,
        suppliers: (suppliers || []).length,
        purchases: (purchases || []).length,
        purchaseItems: (purchaseItems || []).length,
        purchaseInvoices: (purchaseInvoices || []).length,
        purchaseInvoiceItems: (purchaseInvoiceItems || []).length,
        supplierPayments: (supplierPayments || []).length,
        sales: (sales || []).length,
        saleItems: (saleItems || []).length,
        returns: (returns || []).length,
        shiftLogs: (shiftLogs || []).length,
        stocktakeSessions: (stocktakeSessions || []).length,
        stocktakeItems: (stocktakeItems || []).length,
        expenses: (expenses || []).length,
      },
    };
  }
}
