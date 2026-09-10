import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MedicinesService } from '../medicines/medicines.service';
import {
  BulkStockEntryDto,
  UpdateItemPriceDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  RecordSupplierPaymentDto,
  ReturnToSupplierDto,
} from './dto/bulk-stock-entry.dto';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private static readonly verifiedSchemas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly medicinesService: MedicinesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Helper to ensure suppliers & purchases tables exist in the tenant schema.
   * Tables and sequences are managed deterministically by TenantMigrationService.
   */
  private async ensurePurchaseTablesExist(_schemaName: string) {
    // No-op: All schema structures are version-controlled and applied by TenantMigrationService
    return;
  }

  /**
   * Atomically generate a collision-free sequential business invoice number from database sequence
   * Format: PUR-YYYY-00001
   */
  async generatePurchaseInvoiceNumber(schema: string, tx?: any): Promise<string> {
    const client = tx || this.prisma;
    const res: any[] = await client.$queryRawUnsafe(
      `SELECT nextval('"${schema}".purchase_invoice_seq') as nextval;`
    );
    const seq = Number(res[0]?.nextval || 1);
    const year = new Date().getFullYear();
    return `PUR-${year}-${String(seq).padStart(5, '0')}`;
  }

  /**
   * Get suppliers debt overview metrics
   */
  async getSuppliersSummary() {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const sql = `
      SELECT 
        COUNT(DISTINCT s.id)::int as "suppliersCount",
        COUNT(DISTINCT CASE WHEN p.remaining_amount > 0 THEN s.id END)::int as "indebtedSuppliersCount",
        COALESCE(SUM(p.net_total_amount), 0)::numeric as "totalPurchasedAmount",
        COALESCE(SUM(p.paid_amount), 0)::numeric as "totalPaidAmount",
        COALESCE(SUM(p.remaining_amount), 0)::numeric as "totalRemainingDebt"
      FROM "${schemaName}".suppliers s
      LEFT JOIN "${schemaName}".purchases p ON s.id = p.supplier_id;
    `;

    const res: any[] = await this.prisma.$queryRawUnsafe(sql);
    const row = res[0] || {};

    return {
      suppliersCount: Number(row.suppliersCount || 0),
      indebtedSuppliersCount: Number(row.indebtedSuppliersCount || 0),
      totalPurchasedAmount: Number(row.totalPurchasedAmount || 0),
      totalPaidAmount: Number(row.totalPaidAmount || 0),
      totalRemainingDebt: Number(row.totalRemainingDebt || 0),
    };
  }

  /**
   * Get all suppliers with aggregated debts and purchase totals
   */
  async getSuppliers() {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const sql = `
      SELECT 
        s.id,
        s.name,
        s.phone,
        s.address,
        s.notes,
        s.created_at as "createdAt",
        COUNT(p.id)::int as "invoicesCount",
        COALESCE(SUM(p.net_total_amount), 0)::numeric as "totalPurchasedAmount",
        COALESCE(SUM(p.paid_amount), 0)::numeric as "totalPaidAmount",
        COALESCE(SUM(p.remaining_amount), 0)::numeric as "totalRemainingDebt",
        MAX(p.created_at) as "lastPurchaseDate",
        MIN(CASE WHEN p.remaining_amount > 0 THEN p.due_date END) as "nextDueDate"
      FROM "${schemaName}".suppliers s
      LEFT JOIN "${schemaName}".purchases p ON s.id = p.supplier_id
      GROUP BY s.id
      ORDER BY COALESCE(SUM(p.remaining_amount), 0) DESC, s.name ASC;
    `;

    const suppliers: any[] = await this.prisma.$queryRawUnsafe(sql);
    return suppliers;
  }

  /**
   * Create new supplier
   */
  async createSupplier(dto: CreateSupplierDto) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const cleanName = dto.name.trim();
    const existing: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM "${schemaName}".suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      cleanName,
    );

    if (existing.length > 0) {
      throw new BadRequestException('اسم المذخر مسجل مسبقاً في الصيدلية');
    }

    const supplierId = crypto.randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".suppliers (id, name, phone, address, notes, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5, NOW())`,
      supplierId,
      cleanName,
      dto.phone || null,
      dto.address || null,
      dto.notes || null,
    );

    return {
      success: true,
      message: `تم إضافة مذخر (${cleanName}) بنجاح`,
      supplier: {
        id: supplierId,
        name: cleanName,
        phone: dto.phone,
        address: dto.address,
        notes: dto.notes,
      },
    };
  }

  /**
   * Update supplier details
   */
  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const existing: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM "${schemaName}".suppliers WHERE id = $1::uuid LIMIT 1`,
      id,
    );

    if (existing.length === 0) {
      throw new NotFoundException('المذخر غير موجود');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".suppliers
       SET name = COALESCE($1, name),
           phone = $2,
           address = $3,
           notes = $4
       WHERE id = $5::uuid`,
      dto.name ? dto.name.trim() : null,
      dto.phone !== undefined ? dto.phone : null,
      dto.address !== undefined ? dto.address : null,
      dto.notes !== undefined ? dto.notes : null,
      id,
    );

    return {
      success: true,
      message: 'تم تحديث بيانات المذخر بنجاح',
    };
  }

  /**
   * Get detailed account statement (Ledger) for a specific supplier
   */
  async getSupplierLedger(supplierId: string) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    // 1. Get supplier
    const supRows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, name, phone, address, notes, created_at as "createdAt"
       FROM "${schemaName}".suppliers WHERE id = $1::uuid LIMIT 1`,
      supplierId,
    );

    if (supRows.length === 0) {
      throw new NotFoundException('المذخر غير موجود');
    }

    const supplier = supRows[0];

    // 2. Get all purchase invoices for this supplier
    const invoices: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT 
        p.id,
        p.invoice_number as "invoiceNumber",
        p.total_gross_amount as "totalGrossAmount",
        p.total_discount_amount as "totalDiscountAmount",
        p.net_total_amount as "netTotalAmount",
        p.paid_amount as "paidAmount",
        p.remaining_amount as "remainingAmount",
        p.payment_status as "paymentStatus",
        p.due_date as "dueDate",
        p.notes,
        p.created_at as "createdAt",
        COUNT(pi.id)::int as "itemsCount"
      FROM "${schemaName}".purchases p
      LEFT JOIN "${schemaName}".purchase_items pi ON p.id = pi.purchase_id
      WHERE p.supplier_id = $1::uuid
      GROUP BY p.id
      ORDER BY p.created_at DESC;`,
      supplierId,
    );

    // 3. Get all payment vouchers made to this supplier
    const payments: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT 
        id,
        purchase_id as "purchaseId",
        amount,
        COALESCE(discount_percent, 0)::numeric as "discountPercent",
        COALESCE(discount_amount, 0)::numeric as "discountAmount",
        COALESCE(net_paid_amount, amount)::numeric as "netPaidAmount",
        payment_date as "paymentDate",
        payment_method as "paymentMethod",
        receipt_number as "receiptNumber",
        receipt_image as "receiptImage",
        notes,
        created_at as "createdAt"
      FROM "${schemaName}".supplier_payments
      WHERE supplier_id = $1::uuid
      ORDER BY payment_date DESC, created_at DESC;`,
      supplierId,
    );

    // Totals
    const totalPurchased = invoices.reduce((sum, i) => sum + Number(i.netTotalAmount || 0), 0);
    const totalPaid = invoices.reduce((sum, i) => sum + Number(i.paidAmount || 0), 0);
    const totalDebt = invoices.reduce((sum, i) => sum + Number(i.remainingAmount || 0), 0);

    return {
      supplier,
      summary: {
        totalPurchased,
        totalPaid,
        totalDebt,
        invoicesCount: invoices.length,
        paymentsCount: payments.length,
      },
      invoices,
      payments,
    };
  }

  /**
   * Record debt payment installment to a supplier
   */
  async recordSupplierPayment(supplierId: string, dto: RecordSupplierPaymentDto) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const payAmount = Number(dto.amount);

    if (payAmount <= 0) {
      throw new BadRequestException('مبلغ الدفعة يجب أن يكون أكبر من صفر');
    }

    // Process discount fields
    const discountPercent = Number(dto.discountPercent || 0);
    let discountAmount = Number(dto.discountAmount || 0);
    if (discountAmount <= 0 && discountPercent > 0) {
      discountAmount = Math.round((payAmount * discountPercent) / 100);
    }
    const netPaidAmount = Number(
      dto.netPaidAmount !== undefined
        ? dto.netPaidAmount
        : Math.max(0, payAmount - discountAmount),
    );

    let finalNotes = dto.notes ? dto.notes.trim() : '';
    if (discountAmount > 0) {
      const discountLabel = `(خصم تسديد: ${discountPercent}% بقيمة ${discountAmount.toLocaleString()} د.ع | الصافي المدفوع: ${netPaidAmount.toLocaleString()} د.ع)`;
      finalNotes = finalNotes ? `${finalNotes} - ${discountLabel}` : discountLabel;
    }

    const paymentId = crypto.randomUUID();
    const payDate = dto.paymentDate || new Date().toISOString().slice(0, 10);

    const { supplierName } = await this.prisma.$transaction(
      async (tx) => {
        // 1. Verify supplier
        const supRows: any[] = await tx.$queryRawUnsafe(
          `SELECT id, name FROM "${schemaName}".suppliers WHERE id = $1::uuid LIMIT 1`,
          supplierId,
        );

        if (supRows.length === 0) {
          throw new NotFoundException('المذخر غير موجود');
        }

        const supplier = supRows[0];

        // 2. Insert Payment Voucher Record
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schemaName}".supplier_payments
           (id, supplier_id, amount, discount_percent, discount_amount, net_paid_amount, payment_date, payment_method, receipt_number, notes, receipt_image, created_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, NOW())`,
          paymentId,
          supplierId,
          payAmount,
          discountPercent,
          discountAmount,
          netPaidAmount,
          payDate,
          dto.paymentMethod || 'CASH',
          dto.receiptNumber || null,
          finalNotes || null,
          dto.receiptImage || null,
        );

        // 3. Deduct payment from unpaid purchases using FIFO
        const unpaidPurchases: any[] = await tx.$queryRawUnsafe(
          `SELECT id, net_total_amount, paid_amount, remaining_amount
           FROM "${schemaName}".purchases
           WHERE supplier_id = $1::uuid AND remaining_amount > 0
           ORDER BY created_at ASC;`,
          supplierId,
        );

        let remainingToDeduct = payAmount;

        for (const p of unpaidPurchases) {
          if (remainingToDeduct <= 0) break;

          const pRemaining = Number(p.remaining_amount);
          const deductFromThis = Math.min(remainingToDeduct, pRemaining);

          const newPaid = Number(p.paid_amount) + deductFromThis;
          const newRemaining = pRemaining - deductFromThis;
          const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIAL';

          await tx.$executeRawUnsafe(
            `UPDATE "${schemaName}".purchases
             SET paid_amount = $1,
                 remaining_amount = $2,
                 payment_status = $3
             WHERE id = $4::uuid`,
            newPaid,
            newRemaining,
            newStatus,
            p.id,
          );

          // Also keep purchase_invoices in sync
          try {
            await tx.$executeRawUnsafe(
              `UPDATE "${schemaName}".purchase_invoices
               SET paid_amount = $1,
                   remaining_amount = $2,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3::uuid`,
              newPaid,
              newRemaining,
              p.id,
            );
          } catch {}

          remainingToDeduct -= deductFromThis;
        }

        return { supplierName: supplier.name };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    this.logger.log(
      `Payment voucher of ${payAmount} IQD recorded for supplier ${supplierName} in schema ${schemaName}`,
    );

    return {
      success: true,
      message:
        discountAmount > 0
          ? `تم توثيق تسديد بمبلغ (${payAmount.toLocaleString()} د.ع) مع خصم مكتسب (${discountAmount.toLocaleString()} د.ع) - الصافي المدفوع: (${netPaidAmount.toLocaleString()} د.ع) لمذخر (${supplierName}) بنجاح`
          : `تم توثيق تسديد دفعة بمبلغ (${payAmount.toLocaleString()} د.ع) لمذخر (${supplierName}) بنجاح`,
      paymentId,
    };
  }

  /**
   * Create or find supplier by name
   */
  async upsertSupplier(name: string, phone?: string, tx?: any) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const client = tx || this.prisma;
    const cleanName = name.trim();
    const existing: any[] = await client.$queryRawUnsafe(
      `SELECT id FROM "${schemaName}".suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      cleanName,
    );

    if (existing.length > 0) {
      return existing[0].id;
    }

    const supplierId = crypto.randomUUID();
    await client.$executeRawUnsafe(
      `INSERT INTO "${schemaName}".suppliers (id, name, phone, created_at)
       VALUES ($1::uuid, $2, $3, NOW())`,
      supplierId,
      cleanName,
      phone || null,
    );

    return supplierId;
  }

  /**
   * Get accurate inventory counts summary for stats cards
   */
  async getInventorySummary() {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const [totalRes, lowStockRes, expRes] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(id)::int as count FROM "${schemaName}".inventory_items;`,
      ),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT COUNT(*)::int as count FROM (
          SELECT i.id
          FROM "${schemaName}".inventory_items i
          LEFT JOIN "${schemaName}".inventory_batches b ON i.id = b.inventory_item_id
          GROUP BY i.id, i.min_alert_units
          HAVING COALESCE(SUM(b.quantity_units_remaining), 0) <= i.min_alert_units
        ) sub;
      `),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT COUNT(id)::int as count
        FROM "${schemaName}".inventory_batches
        WHERE quantity_units_remaining > 0 
          AND expiry_date <= (CURRENT_DATE + interval '3 months');
      `),
    ]);

    return {
      totalMedicines: Number(totalRes[0]?.count || 0),
      totalCount: Number(totalRes[0]?.count || 0),
      lowStockCount: Number(lowStockRes[0]?.count || 0),
      expiringSoonCount: Number(expRes[0]?.count || 0),
    };
  }

  /**
   * Process Bulk Stock Entry (New shipment / invoice of medicines with bonus, discount & supplier debt)
   */
  async bulkStockEntry(dto: BulkStockEntryDto) {
    const schemaName = this.tenantContext.getSchemaName();
    const tenantId = this.tenantContext.getTenantId();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('يجب إضافة مادة واحدة على الأقل في الوجبة');
    }

    await this.ensurePurchaseTablesExist(schemaName);

    // 0. Pre-calculate Invoice Totals & Direct Discount
    let invoiceGrossTotal = 0;
    let itemDiscountsTotal = 0;
    let subtotalBeforeDirectDiscount = 0;

    for (const it of dto.items) {
      const q = Number(it.quantityPacks || 1);
      const p = Number(it.purchasePricePack || 0);
      const d = Number(it.discountPercent || 0);
      const gross = q * p;
      const disc = gross * (d / 100);
      const net = gross - disc;
      invoiceGrossTotal += gross;
      itemDiscountsTotal += disc;
      subtotalBeforeDirectDiscount += net;
    }

    let directDiscountAmount = 0;
    if (dto.directDiscountAmount !== undefined && Number(dto.directDiscountAmount) > 0) {
      directDiscountAmount = Math.min(subtotalBeforeDirectDiscount, Number(dto.directDiscountAmount));
    } else if (dto.directDiscountType === 'PERCENT' && dto.directDiscountPercent && Number(dto.directDiscountPercent) > 0) {
      directDiscountAmount = Math.round(subtotalBeforeDirectDiscount * (Math.min(100, Number(dto.directDiscountPercent)) / 100));
    }

    const invoiceDiscountTotal = itemDiscountsTotal + directDiscountAmount;
    const invoiceNetTotal = Math.max(0, subtotalBeforeDirectDiscount - directDiscountAmount);

    const paymentStatus = dto.paymentStatus || 'PAID';
    let paidAmount = Number(dto.paidAmount !== undefined ? dto.paidAmount : invoiceNetTotal);
    if (paymentStatus === 'PAID') {
      paidAmount = invoiceNetTotal;
    } else if (paymentStatus === 'UNPAID') {
      paidAmount = 0;
    }
    const remainingAmount = Math.max(0, invoiceNetTotal - paidAmount);

    const finalNotes = directDiscountAmount > 0
      ? [dto.notes, `خصم مباشر: ${directDiscountAmount.toLocaleString()} د.ع`].filter(Boolean).join(' | ')
      : dto.notes || null;

    // Execute the bulk stock entry atomically inside an ACID transaction
    const transactionResult = await this.prisma.$transaction(
      async (tx) => {
        // Resolve or generate atomic sequential invoice number
        const invoiceNumber = (dto.supplierInvoiceNumber && dto.supplierInvoiceNumber.trim().length > 0)
          ? dto.supplierInvoiceNumber.trim()
          : await this.generatePurchaseInvoiceNumber(schemaName, tx);

        // 1. Resolve Supplier
        let finalSupplierId: string | null = dto.supplierId || null;
        if (!finalSupplierId && dto.supplierName && dto.supplierName.trim().length > 0) {
          finalSupplierId = await this.upsertSupplier(dto.supplierName, dto.supplierPhone, tx);
        }

        const processedMedicineIds: string[] = [];
        const purchaseId = crypto.randomUUID();
        const purchaseItemsToInsert: any[] = [];

        // Process each item in the invoice
        for (const item of dto.items) {
          let finalMedicineId = item.medicineId;
          if (finalMedicineId) {
            const check = await tx.$queryRawUnsafe<any[]>(
              `SELECT id FROM public.medicines WHERE id = $1::uuid LIMIT 1;`,
              finalMedicineId,
            );
            if (check.length === 0) {
              finalMedicineId = undefined;
            }
          }

          // 1.1 If item is a new medicine not in catalog -> create in Master DB
          if (!finalMedicineId && item.newMedicineData) {
            const createdMed = await tx.medicine.create({
              data: {
                tradeName: item.newMedicineData.tradeName.trim(),
                scientificName: item.newMedicineData.scientificName?.trim() || null,
                dosageForm: item.newMedicineData.dosageForm || null,
                strength: item.newMedicineData.strength || null,
                manufacturer: item.newMedicineData.manufacturer || null,
                barcode: item.newMedicineData.barcode?.trim() || null,
                defaultUnitsPerPack: item.unitsPerPack || 1,
                isVerified: false,
                needsPackagingReview: true,
              },
            });
            finalMedicineId = createdMed.id;
          }

          if (!finalMedicineId) {
            throw new BadRequestException('معرف الدواء غير محدد');
          }

          processedMedicineIds.push(finalMedicineId);

          // 1.2 Financial & Bonus calculations
          const qtyPacks = Number(item.quantityPacks || 1);
          const bonusPacks = Number(item.bonusPacks || 0);
          const amortizeBonus = item.amortizeBonus !== false;
          const discountPercent = Number(item.discountPercent || 0);
          const purchasePricePack = Number(item.purchasePricePack || 0);

          const lineGrossCost = qtyPacks * purchasePricePack;
          const lineDiscountAmount = lineGrossCost * (discountPercent / 100);
          const lineNetBeforeDirect = lineGrossCost - lineDiscountAmount;

          // Allocate share of direct discount proportionally across items
          const lineShareOfDirect = subtotalBeforeDirectDiscount > 0 && directDiscountAmount > 0
            ? (lineNetBeforeDirect / subtotalBeforeDirectDiscount) * directDiscountAmount
            : 0;
          const finalLineNet = Math.max(0, lineNetBeforeDirect - lineShareOfDirect);

          // If amortizeBonus is TRUE (default): cost is diluted across both purchased and bonus packs
          // If amortizeBonus is FALSE: purchased batch keeps undiluted net cost, bonus batch cost = 0!
          const effectiveNetCostPerPack = (amortizeBonus && bonusPacks > 0)
            ? (qtyPacks + bonusPacks > 0 ? finalLineNet / (qtyPacks + bonusPacks) : purchasePricePack)
            : (qtyPacks > 0 ? finalLineNet / qtyPacks : purchasePricePack);

          // 1.3 Format Expiry Date: YYYY-MM-01
          const expiryDateStr = `${item.expiryYear}-${String(item.expiryMonth).padStart(2, '0')}-01`;

          // 1.4 Upsert Inventory Item in Tenant Schema
          const existingItems: any[] = await tx.$queryRawUnsafe(
            `SELECT id, units_per_pack as "unitsPerPack", selling_price_pack as "sellingPricePack", selling_price_unit as "sellingPriceUnit", shelf_location as "shelfLocation"
             FROM "${schemaName}".inventory_items WHERE medicine_id = $1::uuid LIMIT 1`,
            finalMedicineId,
          );

          let inventoryItemId: string;
          const existing = existingItems[0] || null;
          const resolvedUnits = Number(
            item.unitsPerPack > 1 ? item.unitsPerPack : existing?.unitsPerPack || 1,
          );
          const resolvedSellingPack = Number(
            item.sellingPricePack > 0 ? item.sellingPricePack : existing?.sellingPricePack || 0,
          );
          let resolvedSellingUnit = Number(
            item.sellingPriceUnit > 0 ? item.sellingPriceUnit : existing?.sellingPriceUnit || 0,
          );
          if (resolvedSellingUnit <= 0 && resolvedSellingPack > 0 && resolvedUnits > 0) {
            resolvedSellingUnit = Math.round(resolvedSellingPack / resolvedUnits);
          }
          const resolvedShelf =
            item.shelfLocation && item.shelfLocation.trim().length > 0
              ? item.shelfLocation.trim()
              : existing?.shelfLocation || null;

          if (existing) {
            inventoryItemId = existing.id;
            // Update custom_name, selling prices, units per pack, and shelf_location safely
            await tx.$executeRawUnsafe(
              `UPDATE "${schemaName}".inventory_items
               SET custom_name = COALESCE($1, custom_name),
                   units_per_pack = $2,
                   selling_price_pack = $3,
                   selling_price_unit = $4,
                   min_alert_units = COALESCE($5, min_alert_units),
                   shelf_location = COALESCE($6, shelf_location),
                   updated_at = NOW()
               WHERE id = $7::uuid`,
              item.customName || null,
              resolvedUnits,
              resolvedSellingPack,
              resolvedSellingUnit,
              item.minAlertUnits || 5,
              resolvedShelf,
              inventoryItemId,
            );
          } else {
            inventoryItemId = crypto.randomUUID();
            await tx.$executeRawUnsafe(
              `INSERT INTO "${schemaName}".inventory_items
               (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit, min_alert_units, shelf_location, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
              inventoryItemId,
              finalMedicineId,
              item.customName || null,
              resolvedUnits,
              resolvedSellingPack,
              resolvedSellingUnit,
              item.minAlertUnits || 5,
              resolvedShelf,
            );
          }

          // 1.5 Insert Batch Record(s) into Tenant Schema
          if (!amortizeBonus && bonusPacks > 0) {
            // Case A: Separate Batches (وجبة الشراء الأساسية + وجبة دواء بونص منفصلة بسعر 0 د.ع)
            // 1.5.1 Purchased Batch
            const purchasedUnits = qtyPacks * resolvedUnits;
            const purchasedBatchId = crypto.randomUUID();
            await tx.$executeRawUnsafe(
              `INSERT INTO "${schemaName}".inventory_batches
               (id, inventory_item_id, supplier_id, purchase_id, batch_number, purchase_price_pack, selling_price_pack, selling_price_unit, quantity_units_remaining, expiry_date, is_recalled, is_bonus, created_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::date, FALSE, FALSE, NOW())`,
              purchasedBatchId,
              inventoryItemId,
              finalSupplierId,
              purchaseId,
              item.batchNumber || null,
              Math.round(effectiveNetCostPerPack),
              resolvedSellingPack,
              resolvedSellingUnit,
              purchasedUnits,
              expiryDateStr,
            );

            // 1.5.2 Bonus Batch (وجبة دواء بونص منفصلة بسعر شراء 0 د.ع)
            const bonusUnits = bonusPacks * resolvedUnits;
            const bonusBatchId = crypto.randomUUID();
            const bonusBatchNumber = (item.bonusBatchNumber && item.bonusBatchNumber.trim().length > 0 && item.bonusBatchNumber.trim() !== 'null' && item.bonusBatchNumber.trim() !== 'N/A')
              ? item.bonusBatchNumber.trim()
              : (item.batchNumber ? `${item.batchNumber}-BONUS` : null);
            const bonusExpiryDateStr = (item.bonusExpiryYear && item.bonusExpiryMonth)
              ? `${item.bonusExpiryYear}-${String(item.bonusExpiryMonth).padStart(2, '0')}-01`
              : expiryDateStr;

            await tx.$executeRawUnsafe(
              `INSERT INTO "${schemaName}".inventory_batches
               (id, inventory_item_id, supplier_id, purchase_id, batch_number, purchase_price_pack, selling_price_pack, selling_price_unit, quantity_units_remaining, expiry_date, is_recalled, is_bonus, created_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 0, $6, $7, $8, $9::date, FALSE, TRUE, NOW())`,
              bonusBatchId,
              inventoryItemId,
              finalSupplierId,
              purchaseId,
              bonusBatchNumber,
              resolvedSellingPack,
              resolvedSellingUnit,
              bonusUnits,
              bonusExpiryDateStr,
            );
          } else {
            // Case B: Amortized / Dissolved (تذويب البونص في السعر - وجبة واحدة جامعة)
            const totalPacksReceived = qtyPacks + bonusPacks;
            const totalUnits = totalPacksReceived * resolvedUnits;
            const batchId = crypto.randomUUID();

            await tx.$executeRawUnsafe(
              `INSERT INTO "${schemaName}".inventory_batches
               (id, inventory_item_id, supplier_id, purchase_id, batch_number, purchase_price_pack, selling_price_pack, selling_price_unit, quantity_units_remaining, expiry_date, is_recalled, is_bonus, created_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::date, FALSE, FALSE, NOW())`,
              batchId,
              inventoryItemId,
              finalSupplierId,
              purchaseId,
              item.batchNumber || null,
              Math.round(effectiveNetCostPerPack),
              resolvedSellingPack,
              resolvedSellingUnit,
              totalUnits,
              expiryDateStr,
            );
          }

          purchaseItemsToInsert.push({
            id: crypto.randomUUID(),
            purchaseId,
            inventoryItemId,
            quantityPacks: qtyPacks,
            bonusPacks,
            amortizeBonus,
            unitsPerPack: item.unitsPerPack,
            purchasePricePack,
            discountPercent,
            netCostPack: Math.round(effectiveNetCostPerPack),
            sellingPricePack: resolvedSellingPack,
            sellingPriceUnit: resolvedSellingUnit,
            expiryDate: expiryDateStr,
            batchNumber: item.batchNumber || null,
          });
        }

        // 2. Record Purchase Header
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schemaName}".purchases
           (id, invoice_number, supplier_id, supplier_name, total_gross_amount, total_discount_amount, net_total_amount, paid_amount, remaining_amount, payment_status, due_date, notes, created_at)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, NOW())`,
          purchaseId,
          invoiceNumber,
          finalSupplierId,
          dto.supplierName || null,
          invoiceGrossTotal,
          invoiceDiscountTotal,
          invoiceNetTotal,
          paidAmount,
          remainingAmount,
          paymentStatus,
          dto.dueDate || null,
          finalNotes,
        );

        // 3. Record Purchase Line Items
        for (const pi of purchaseItemsToInsert) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "${schemaName}".purchase_items
             (id, purchase_id, inventory_item_id, quantity_packs, bonus_packs, amortize_bonus, units_per_pack, purchase_price_pack, discount_percent, net_cost_pack, selling_price_pack, selling_price_unit, expiry_date, batch_number)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14)`,
            pi.id,
            pi.purchaseId,
            pi.inventoryItemId,
            pi.quantityPacks,
            pi.bonusPacks,
            pi.amortizeBonus,
            pi.unitsPerPack,
            pi.purchasePricePack,
            pi.discountPercent,
            pi.netCostPack,
            pi.sellingPricePack,
            pi.sellingPriceUnit,
            pi.expiryDate,
            pi.batchNumber,
          );
        }

        return {
          purchaseId,
          invoiceNumber,
          processedMedicineIds,
        };
      },
      {
        maxWait: 10000,
        timeout: 30000,
      }
    );

    // 4. Emit stock sync event to update CentralSearchIndex in background ONLY after transaction commits
    this.eventEmitter.emit('inventory.synced', {
      tenantId,
      schemaName,
      medicineIds: transactionResult.processedMedicineIds,
    });

    this.logger.log(
      `Bulk stock entry saved for tenant "${tenantId}". Purchase ID: ${transactionResult.purchaseId}. Total items: ${dto.items.length}`,
    );

    return {
      success: true,
      purchaseId: transactionResult.purchaseId,
      invoiceNumber: transactionResult.invoiceNumber,
      message: `تم اعتماد وحفظ فاتورة المشتريات بنجاح (${dto.items.length} مادة)`,
      invoiceSummary: {
        totalGross: invoiceGrossTotal,
        totalDiscount: invoiceDiscountTotal,
        netTotal: invoiceNetTotal,
        paidAmount,
        remainingAmount,
        paymentStatus,
      },
    };
  }

  /**
   * Get all pharmacy inventory items with master info, custom alias name, and calculated stock
   */
  async getPharmacyInventory(query?: { search?: string; supplierId?: string; shelfLocation?: string }) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    let searchFilter = '';
    const params: any[] = [];

    if (query?.search && query.search.trim().length > 0) {
      params.push(`%${query.search.trim()}%`);
      searchFilter += ` AND (m.trade_name ILIKE $${params.length} OR m.scientific_name ILIKE $${params.length} OR m.barcode ILIKE $${params.length} OR i.custom_name ILIKE $${params.length} OR i.shelf_location ILIKE $${params.length})`;
    }

    if (query?.shelfLocation && query.shelfLocation.trim().length > 0) {
      params.push(`%${query.shelfLocation.trim()}%`);
      searchFilter += ` AND i.shelf_location ILIKE $${params.length}`;
    }

    if (query?.supplierId && query.supplierId.trim().length > 0) {
      params.push(query.supplierId.trim());
      searchFilter += ` AND EXISTS (SELECT 1 FROM "${schemaName}".inventory_batches b_sub WHERE b_sub.inventory_item_id = i.id AND b_sub.supplier_id = $${params.length}::uuid AND b_sub.quantity_units_remaining > 0)`;
    }

    const sql = `
      SELECT 
        i.id,
        i.medicine_id as "medicineId",
        i.custom_name as "customName",
        i.units_per_pack as "unitsPerPack",
        i.shelf_location as "shelfLocation",
        COALESCE(
          (SELECT b_sub.selling_price_pack 
           FROM "${schemaName}".inventory_batches b_sub 
           WHERE b_sub.inventory_item_id = i.id 
             AND b_sub.quantity_units_remaining > 0 
             AND b_sub.expiry_date >= CURRENT_DATE 
             AND (b_sub.is_recalled IS FALSE OR b_sub.is_recalled IS NULL)
             AND b_sub.selling_price_pack IS NOT NULL
           ORDER BY b_sub.expiry_date ASC, b_sub.created_at ASC 
           LIMIT 1), 
          i.selling_price_pack
        ) as "sellingPricePack",
        COALESCE(
          (SELECT b_sub.selling_price_unit 
           FROM "${schemaName}".inventory_batches b_sub 
           WHERE b_sub.inventory_item_id = i.id 
             AND b_sub.quantity_units_remaining > 0 
             AND b_sub.expiry_date >= CURRENT_DATE 
             AND (b_sub.is_recalled IS FALSE OR b_sub.is_recalled IS NULL)
             AND b_sub.selling_price_unit IS NOT NULL
           ORDER BY b_sub.expiry_date ASC, b_sub.created_at ASC 
           LIMIT 1), 
          i.selling_price_unit
        ) as "sellingPriceUnit",
        i.min_alert_units as "minAlertUnits",
        COALESCE(i.is_public_visible, TRUE) as "isPublicVisible",
        i.updated_at as "updatedAt",
        COALESCE(i.custom_name, m.trade_name, 'دواء بدون اسم') as "tradeName",
        COALESCE(m.scientific_name, i.custom_name, '') as "scientificName",
        COALESCE(m.dosage_form, 'عام') as "dosageForm",
        COALESCE(m.strength, '') as "strength",
        COALESCE(m.manufacturer, '') as "manufacturer",
        COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
        COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE AND (b.is_recalled IS FALSE OR b.is_recalled IS NULL) THEN b.quantity_units_remaining ELSE 0 END), 0)::int as "validUnitsRemaining",
        COALESCE(SUM(CASE WHEN b.expiry_date < CURRENT_DATE THEN b.quantity_units_remaining ELSE 0 END), 0)::int as "expiredUnitsRemaining",
        FLOOR(COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE AND (b.is_recalled IS FALSE OR b.is_recalled IS NULL) THEN b.quantity_units_remaining ELSE 0 END), 0) / i.units_per_pack)::int as "availablePacks",
        (COALESCE(SUM(CASE WHEN b.expiry_date >= CURRENT_DATE AND (b.is_recalled IS FALSE OR b.is_recalled IS NULL) THEN b.quantity_units_remaining ELSE 0 END), 0) % i.units_per_pack)::int as "availableStrips",
        (
          SELECT json_agg(
            json_build_object(
              'id', b_agg.id,
              'batchNumber', b_agg.batch_number,
              'expiryFormatted', TO_CHAR(b_agg.expiry_date, 'MM/YYYY'),
              'sellingPricePack', COALESCE(b_agg.selling_price_pack, i.selling_price_pack),
              'sellingPriceUnit', COALESCE(b_agg.selling_price_unit, i.selling_price_unit),
              'purchasePricePack', b_agg.purchase_price_pack,
              'quantityUnitsRemaining', b_agg.quantity_units_remaining,
              'availablePacks', FLOOR(b_agg.quantity_units_remaining / i.units_per_pack),
              'availableStrips', (b_agg.quantity_units_remaining % i.units_per_pack)
            ) ORDER BY b_agg.expiry_date ASC, b_agg.created_at ASC
          )
          FROM "${schemaName}".inventory_batches b_agg
          WHERE b_agg.inventory_item_id = i.id 
            AND b_agg.quantity_units_remaining > 0
            AND b_agg.expiry_date >= CURRENT_DATE
            AND (b_agg.is_recalled IS FALSE OR b_agg.is_recalled IS NULL)
        ) as "activeBatches"
      FROM "${schemaName}".inventory_items i
      LEFT JOIN public.medicines m ON i.medicine_id = m.id
      LEFT JOIN "${schemaName}".inventory_batches b ON i.id = b.inventory_item_id AND b.quantity_units_remaining > 0
      WHERE 1=1 ${searchFilter}
      GROUP BY i.id, m.id, m.trade_name, m.scientific_name, m.dosage_form, m.strength, m.manufacturer, m.barcode
      ORDER BY COALESCE(i.custom_name, m.trade_name, '') ASC;
    `;

    const items: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
    return items;
  }

  /**
   * Get last known batch/pricing/shelf/expiry history for a medicine in the current tenant's pharmacy
   * Used for auto-prefilling fast stock entry (BulkStockEntry, SmartInvoiceScanner, etc.)
   * Fetches latest record with the same barcode or medicine ID
   */
  async getMedicineLastHistory(identifier: string) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const cleanId = String(identifier || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);

    // 1. Fetch medicine from master catalog (by ID or Barcode)
    let masterRes: any[] = [];
    if (isUuid) {
      masterRes = await this.prisma.$queryRawUnsafe(
        `SELECT id, trade_name as "tradeName", scientific_name as "scientificName", 
                strength, dosage_form as "dosageForm", 
                COALESCE(default_units_per_pack, 1)::int as "unitsPerPack",
                COALESCE(default_purchase_price, 0)::numeric as "defaultPurchasePrice",
                barcode
         FROM public.medicines 
         WHERE id = $1::uuid OR barcode = $1
         LIMIT 1`,
        cleanId,
      );
    } else {
      masterRes = await this.prisma.$queryRawUnsafe(
        `SELECT id, trade_name as "tradeName", scientific_name as "scientificName", 
                strength, dosage_form as "dosageForm", 
                COALESCE(default_units_per_pack, 1)::int as "unitsPerPack",
                COALESCE(default_purchase_price, 0)::numeric as "defaultPurchasePrice",
                barcode
         FROM public.medicines 
         WHERE barcode = $1 OR trade_name ILIKE $1
         LIMIT 1`,
        cleanId,
      );
    }

    const master = masterRes[0] || null;
    const barcode = master?.barcode || (!isUuid ? cleanId : null);
    const medId = master?.id || (isUuid ? cleanId : null);

    // 2. Query tenant inventory by medicine_id OR barcode!
    // This guarantees matching the latest medicine in this pharmacy with the same barcode
    const itemRes: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT ii.id, ii.medicine_id as "medicineId", ii.custom_name as "customName",
             ii.units_per_pack as "unitsPerPack",
             ii.selling_price_pack as "sellingPricePack",
             ii.selling_price_unit as "sellingPriceUnit",
             ii.shelf_location as "shelfLocation",
             m.barcode, m.trade_name as "masterTradeName"
      FROM "${schemaName}".inventory_items ii
      LEFT JOIN public.medicines m ON ii.medicine_id = m.id
      WHERE ($1::uuid IS NOT NULL AND ii.medicine_id = $1::uuid)
         OR ($2::text IS NOT NULL AND m.barcode = $2::text)
      ORDER BY ii.updated_at DESC
      LIMIT 1;
    `, medId, barcode);

    let lastPurchase: any = null;
    let lastBatch: any = null;
    const inventoryItem = itemRes[0] || null;

    if (inventoryItem) {
      // 3. Try to get the latest purchase item
      try {
        const purchaseRes: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT purchase_price_pack as "purchasePricePack",
                  selling_price_pack as "sellingPricePack",
                  selling_price_unit as "sellingPriceUnit",
                  bonus_packs as "bonusPacks",
                  units_per_pack as "unitsPerPack",
                  EXTRACT(MONTH FROM expiry_date)::int as "expiryMonth",
                  EXTRACT(YEAR FROM expiry_date)::int as "expiryYear",
                  batch_number as "batchNumber"
           FROM "${schemaName}".purchase_items
           WHERE inventory_item_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 1`,
          inventoryItem.id,
        );
        if (purchaseRes.length > 0) {
          lastPurchase = purchaseRes[0];
        }
      } catch (e) {
        // Ignored if purchase_items table is not yet used
      }

      // 4. Also check latest batch
      try {
        const batchRes: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT purchase_price_pack as "purchasePricePack",
                  selling_price_pack as "sellingPricePack",
                  selling_price_unit as "sellingPriceUnit",
                  EXTRACT(MONTH FROM expiry_date)::int as "expiryMonth",
                  EXTRACT(YEAR FROM expiry_date)::int as "expiryYear",
                  batch_number as "batchNumber"
           FROM "${schemaName}".inventory_batches
           WHERE inventory_item_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 1`,
          inventoryItem.id,
        );
        if (batchRes.length > 0) {
          lastBatch = batchRes[0];
        }
      } catch (e) {
        // Ignored
      }
    }

    const unitsPerPack = Number(
      inventoryItem?.unitsPerPack || lastPurchase?.unitsPerPack || master?.unitsPerPack || 1,
    );

    const lastPurchasePricePack = Number(
      lastPurchase?.purchasePricePack ||
        lastBatch?.purchasePricePack ||
        0,
    );

    const purchasePricePack = Number(
      lastPurchasePricePack ||
        master?.defaultPurchasePrice ||
        0,
    );

    const sellingPricePack = Number(
      inventoryItem?.sellingPricePack ||
        lastPurchase?.sellingPricePack ||
        lastBatch?.sellingPricePack ||
        0,
    );

    let sellingPriceUnit = Number(
      inventoryItem?.sellingPriceUnit ||
        lastPurchase?.sellingPriceUnit ||
        lastBatch?.sellingPriceUnit ||
        0,
    );
    if (sellingPriceUnit === 0 && sellingPricePack > 0 && unitsPerPack > 0) {
      sellingPriceUnit = unitsPerPack > 1
        ? Math.max(250, Math.round((sellingPricePack / unitsPerPack) / 250) * 250)
        : sellingPricePack;
    } else if (sellingPriceUnit > 0 && unitsPerPack > 1) {
      sellingPriceUnit = Math.max(250, Math.round(sellingPriceUnit / 250) * 250);
    }

    const shelfLocation = inventoryItem?.shelfLocation ? String(inventoryItem.shelfLocation).trim() : '';
    const bonusPacks = Number(lastPurchase?.bonusPacks || 0);
    const expiryMonth = lastBatch?.expiryMonth || lastPurchase?.expiryMonth || null;
    const expiryYear = lastBatch?.expiryYear || lastPurchase?.expiryYear || null;

    return {
      medicineId: master?.id || inventoryItem?.medicineId || cleanId,
      tradeName: inventoryItem?.customName || master?.tradeName || 'دواء مسجل',
      scientificName: master?.scientificName || '',
      strength: master?.strength || '',
      dosageForm: master?.dosageForm || '',
      barcode: master?.barcode || barcode || '',
      unitsPerPack,
      purchasePricePack,
      lastPurchasePricePack,
      sellingPricePack,
      sellingPriceUnit,
      shelfLocation,
      bonusPacks,
      expiryMonth,
      expiryYear,
      hasPreviousBatch: !!(lastPurchase || lastBatch || inventoryItem),
    };
  }

  /**
   * Get active batches for a single inventory item
   */
  async getItemBatches(inventoryItemId: string) {
    const schemaName = this.tenantContext.getSchemaName();

    const sql = `
      SELECT 
        b.id,
        b.batch_number as "batchNumber",
        b.purchase_price_pack as "purchasePricePack",
        b.selling_price_pack as "sellingPricePack",
        b.selling_price_unit as "sellingPriceUnit",
        b.quantity_units_remaining as "quantityUnitsRemaining",
        TO_CHAR(b.expiry_date, 'MM/YYYY') as "expiryFormatted",
        b.expiry_date as "expiryDate",
        (b.expiry_date < CURRENT_DATE) as "isExpired",
        b.is_recalled as "isRecalled",
        COALESCE(b.is_bonus, FALSE) as "isBonus",
        b.supplier_id as "supplierId",
        b.purchase_id as "purchaseId",
        s.name as "supplierName",
        b.created_at as "createdAt"
      FROM "${schemaName}".inventory_batches b
      LEFT JOIN "${schemaName}".suppliers s ON b.supplier_id = s.id
      WHERE b.inventory_item_id = $1::uuid AND b.quantity_units_remaining > 0
      ORDER BY b.expiry_date ASC;
    `;

    const batches: any[] = await this.prisma.$queryRawUnsafe(sql, inventoryItemId);
    return batches;
  }

  /**
   * Search and trace a batch across stock and sales invoices
   */
  async getBatchTraceability(batchNumber: string) {
    if (!batchNumber || batchNumber.trim().length === 0) {
      throw new BadRequestException('رقم التشغيلة مطلوب لإتمام عملية البحث والتتبع');
    }

    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const cleanBatch = batchNumber.trim();

    // 1. Get Batch Details with Medicine and Supplier info
    const batchesSql = `
      SELECT 
        b.id as "batchId",
        b.batch_number as "batchNumber",
        b.purchase_price_pack as "purchasePricePack",
        b.selling_price_pack as "sellingPricePack",
        b.selling_price_unit as "sellingPriceUnit",
        b.quantity_units_remaining as "quantityUnitsRemaining",
        b.expiry_date as "expiryDate",
        b.is_recalled as "isRecalled",
        COALESCE(b.is_bonus, FALSE) as "isBonus",
        b.created_at as "receivedAt",
        m.trade_name as "tradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.strength as "strength",
        i.units_per_pack as "unitsPerPack",
        s.name as "supplierName",
        s.phone as "supplierPhone",
        p.invoice_number as "purchaseInvoiceNumber"
      FROM "${schemaName}".inventory_batches b
      JOIN "${schemaName}".inventory_items i ON b.inventory_item_id = i.id
      JOIN public.medicines m ON i.medicine_id = m.id
      LEFT JOIN "${schemaName}".suppliers s ON b.supplier_id = s.id
      LEFT JOIN "${schemaName}".purchases p ON b.purchase_id = p.id
      WHERE b.batch_number ILIKE $1;
    `;

    const batches: any[] = await this.prisma.$queryRawUnsafe(batchesSql, `%${cleanBatch}%`);

    if (batches.length === 0) {
      return { found: false, message: 'لم يتم العثور على أي تشغيلة مطابقة للرقم المدخل' };
    }

    const batchIds = batches.map((b) => b.batchId);

    // 2. Get Sales Invoices that dispensed from this batch
    const salesSql = `
      SELECT 
        si.id as "saleItemId",
        si.quantity as "quantitySold",
        si.unit_type as "unitType",
        si.unit_price as "unitPrice",
        si.total_price as "totalPrice",
        s.id as "saleId",
        s.invoice_number as "invoiceNumber",
        s.created_at as "soldAt",
        u.name as "cashierName"
      FROM "${schemaName}".sale_items si
      JOIN "${schemaName}".sales s ON si.sale_id = s.id
      LEFT JOIN "${schemaName}".users u ON s.user_id = u.id
      WHERE si.inventory_batch_id = ANY($1::uuid[])
      ORDER BY s.created_at DESC;
    `;

    const salesHistory: any[] = await this.prisma.$queryRawUnsafe(salesSql, batchIds);

    // 3. Get Customer Returns on this medicine / batch
    const returnsSql = `
      SELECT 
        r.id as "returnId",
        r.quantity as "quantityReturned",
        r.unit_type as "unitType",
        r.refund_amount as "refundAmount",
        r.reason as "reason",
        r.created_at as "returnedAt",
        u.name as "cashierName"
      FROM "${schemaName}".returns r
      LEFT JOIN "${schemaName}".users u ON r.user_id = u.id
      WHERE r.inventory_item_id IN (
        SELECT inventory_item_id FROM "${schemaName}".inventory_batches WHERE id = ANY($1::uuid[])
      )
      ORDER BY r.created_at DESC;
    `;
    const returnsHistory: any[] = await this.prisma.$queryRawUnsafe(returnsSql, batchIds);

    // 4. Get Supplier Returns recorded on this batch
    const suppReturnsSql = `
      SELECT 
        sp.id as "paymentId",
        ABS(sp.amount) as "refundAmount",
        sp.payment_date as "returnedAt",
        sp.receipt_number as "receiptNumber",
        sp.notes as "notes",
        s.name as "supplierName"
      FROM "${schemaName}".supplier_payments sp
      LEFT JOIN "${schemaName}".suppliers s ON sp.supplier_id = s.id
      WHERE sp.notes ILIKE $1
      ORDER BY sp.payment_date DESC;
    `;
    const supplierReturnsHistory: any[] = await this.prisma.$queryRawUnsafe(suppReturnsSql, `%${cleanBatch}%`);

    return {
      found: true,
      batches,
      salesHistory,
      returnsHistory,
      supplierReturnsHistory,
    };
  }

  /**
   * Set Recall (Block / Unblock) for a batch number
   */
  async setBatchRecall(batchNumber: string, isRecalled: boolean) {
    if (!batchNumber || batchNumber.trim().length === 0) {
      throw new BadRequestException('رقم التشغيلة مطلوب لتنفيذ إجراء السحب أو القفل');
    }

    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const res = await this.prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".inventory_batches
       SET is_recalled = $1
       WHERE batch_number = $2`,
      isRecalled,
      batchNumber.trim(),
    );

    return {
      success: true,
      updatedCount: res,
      message: isRecalled
        ? `تم قفل وسحب التشغيلة (${batchNumber}) بنجاح، ولن يتمكن الكاشير من بيعها.`
        : `تم إلغاء قفل التشغيلة (${batchNumber}) وإعادتها للبيع بنجاح.`,
    };
  }

  /**
   * Update selling price, custom name, or low stock alert for an inventory item
   */
  async updateItemPrice(inventoryItemId: string, dto: UpdateItemPriceDto) {
    const schemaName = this.tenantContext.getSchemaName();
    const tenantId = this.tenantContext.getTenantId();

    const check: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT medicine_id FROM "${schemaName}".inventory_items WHERE id = $1::uuid`,
      inventoryItemId,
    );

    if (check.length === 0) {
      throw new NotFoundException('المادة غير موجودة في المخزون');
    }

    const medicineId = check[0].medicine_id;

    await this.prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".inventory_items
       SET custom_name = $1,
           selling_price_pack = $2,
           selling_price_unit = $3,
           min_alert_units = COALESCE($4, min_alert_units),
           shelf_location = $5,
           updated_at = NOW()
       WHERE id = $6::uuid`,
      dto.customName !== undefined ? dto.customName : null,
      dto.sellingPricePack,
      dto.sellingPriceUnit,
      dto.minAlertUnits || null,
      dto.shelfLocation !== undefined ? dto.shelfLocation : null,
      inventoryItemId,
    );

    // Emit sync event
    this.eventEmitter.emit('inventory.synced', {
      tenantId,
      schemaName,
      medicineIds: [medicineId],
    });

    return { success: true, message: 'تم تحديث بيانات وسعر المادة بنجاح' };
  }

  /**
   * Toggle item visibility in public network search
   */
  async toggleItemPublicVisibility(inventoryItemId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const schemaName = this.tenantContext.getSchemaName();

    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, medicine_id as "medicineId", is_public_visible as "isPublicVisible" FROM "${schemaName}".inventory_items WHERE id = $1::uuid LIMIT 1`,
      inventoryItemId,
    );

    if (rows.length === 0) {
      throw new NotFoundException('المادة غير موجودة');
    }

    const currentVisible = rows[0].isPublicVisible !== false;
    const newVisible = !currentVisible;

    await this.prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".inventory_items SET is_public_visible = $1, updated_at = NOW() WHERE id = $2::uuid`,
      newVisible,
      inventoryItemId,
    );

    // Sync central search index
    if (!newVisible) {
      await this.prisma.centralSearchIndex.updateMany({
        where: { tenantId, medicineId: rows[0].medicineId },
        data: { isAvailable: false },
      });
    } else {
      this.eventEmitter.emit('inventory.synced', {
        tenantId,
        schemaName,
        medicineIds: [rows[0].medicineId],
      });
    }

    return {
      success: true,
      isPublicVisible: newVisible,
      message: newVisible ? 'تم إظهار الدواء في البحث الشبكي العام 🌐' : 'تم إخفاء الدواء من البحث الشبكي العام 🔒',
    };
  }

  /**
   * Get items that are below minimum alert threshold (Low Stock Alert)
   */
  async getLowStockAlerts() {
    const schemaName = this.tenantContext.getSchemaName();

    const sql = `
      SELECT 
        i.id,
        i.custom_name as "customName",
        COALESCE(i.custom_name, m.trade_name, 'دواء بدون اسم') as "tradeName",
        COALESCE(m.scientific_name, i.custom_name, '') as "scientificName",
        i.units_per_pack as "unitsPerPack",
        i.min_alert_units as "minAlertUnits",
        COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
        FLOOR(COALESCE(SUM(b.quantity_units_remaining), 0) / i.units_per_pack)::int as "availablePacks",
        (COALESCE(SUM(b.quantity_units_remaining), 0) % i.units_per_pack)::int as "availableStrips"
      FROM "${schemaName}".inventory_items i
      LEFT JOIN public.medicines m ON i.medicine_id = m.id
      LEFT JOIN "${schemaName}".inventory_batches b ON i.id = b.inventory_item_id
      GROUP BY i.id, m.id, m.trade_name, m.scientific_name
      HAVING COALESCE(SUM(b.quantity_units_remaining), 0) <= i.min_alert_units
      ORDER BY COALESCE(SUM(b.quantity_units_remaining), 0) ASC;
    `;

    const lowStockItems: any[] = await this.prisma.$queryRawUnsafe(sql);
    return lowStockItems;
  }

  /**
   * Get batches expiring soon (e.g. within 3 or 6 months)
   */
  async getExpiringSoonAlerts(months: number = 3) {
    const schemaName = this.tenantContext.getSchemaName();

    const sql = `
      SELECT 
        b.id as "batchId",
        COALESCE(i.custom_name, m.trade_name, 'دواء بدون اسم') as "tradeName",
        COALESCE(m.scientific_name, i.custom_name, '') as "scientificName",
        b.batch_number as "batchNumber",
        b.quantity_units_remaining as "quantityUnitsRemaining",
        TO_CHAR(b.expiry_date, 'MM/YYYY') as "expiryFormatted",
        b.expiry_date as "expiryDate"
      FROM "${schemaName}".inventory_batches b
      JOIN "${schemaName}".inventory_items i ON b.inventory_item_id = i.id
      LEFT JOIN public.medicines m ON i.medicine_id = m.id
      WHERE b.quantity_units_remaining > 0 
        AND b.expiry_date <= (CURRENT_DATE + ($1 || ' months')::interval)
      ORDER BY b.expiry_date ASC;
    `;

    const expiringBatches: any[] = await this.prisma.$queryRawUnsafe(sql, months);
    return expiringBatches;
  }

  /**
   * Comprehensive Smart Expiry Analytics with Tier Breakdown & Financial Risk Assessment
   */
  async getSmartExpirySummary(options?: {
    search?: string;
    supplierId?: string;
    months?: number;
    allBatches?: boolean;
    tier?: string;
    year?: number;
    month?: number;
  }) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    const conditions: string[] = ['b.quantity_units_remaining > 0'];
    const params: any[] = [];

    // If not allBatches and no search/year/tier specified, default to 180 days for fast summary
    if (!options?.allBatches && !options?.search && !options?.year && !options?.month && !options?.tier && !options?.months) {
      conditions.push(`b.expiry_date <= (CURRENT_DATE + interval '180 days')`);
    } else if (options?.months && options.months > 0) {
      params.push(options.months);
      conditions.push(`b.expiry_date <= (CURRENT_DATE + ($${params.length} || ' months')::interval)`);
    }

    if (options?.supplierId) {
      params.push(options.supplierId);
      conditions.push(`b.supplier_id = $${params.length}::uuid`);
    }

    if (options?.year) {
      params.push(options.year);
      conditions.push(`EXTRACT(YEAR FROM b.expiry_date) = $${params.length}`);
    }

    if (options?.month) {
      params.push(options.month);
      conditions.push(`EXTRACT(MONTH FROM b.expiry_date) = $${params.length}`);
    }

    if (options?.search && options.search.trim().length > 0) {
      const q = options.search.trim();
      params.push(`%${q}%`);
      const pIdx = params.length;
      conditions.push(`(
        COALESCE(i.custom_name, m.trade_name) ILIKE $${pIdx}
        OR m.scientific_name ILIKE $${pIdx}
        OR m.barcode ILIKE $${pIdx}
        OR b.batch_number ILIKE $${pIdx}
        OR s.name ILIKE $${pIdx}
        OR TO_CHAR(b.expiry_date, 'MM/YYYY') ILIKE $${pIdx}
        OR TO_CHAR(b.expiry_date, 'YYYY-MM') ILIKE $${pIdx}
        OR TO_CHAR(b.expiry_date, 'YYYY') ILIKE $${pIdx}
      )`);
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT 
        b.id as "batchId",
        b.batch_number as "batchNumber",
        b.purchase_price_pack as "purchasePricePack",
        b.selling_price_pack as "sellingPricePack",
        b.selling_price_unit as "sellingPriceUnit",
        b.quantity_units_remaining as "quantityUnitsRemaining",
        b.expiry_date as "expiryDate",
        TO_CHAR(b.expiry_date, 'YYYY-MM-DD') as "expiryDateStr",
        TO_CHAR(b.expiry_date, 'MM/YYYY') as "expiryFormatted",
        (b.expiry_date - CURRENT_DATE)::int as "daysUntilExpiry",
        b.is_recalled as "isRecalled",
        COALESCE(b.is_bonus, FALSE) as "isBonus",
        i.id as "inventoryItemId",
        i.units_per_pack as "unitsPerPack",
        i.shelf_location as "shelfLocation",
        COALESCE(i.custom_name, m.trade_name) as "tradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.strength as "strength",
        m.barcode as "barcode",
        s.id as "supplierId",
        s.name as "supplierName",
        s.phone as "supplierPhone",
        p.invoice_number as "purchaseInvoiceNumber",
        FLOOR(b.quantity_units_remaining / i.units_per_pack)::int as "packsRemaining",
        (b.quantity_units_remaining % i.units_per_pack)::int as "stripsRemaining",
        ROUND((b.quantity_units_remaining::numeric / NULLIF(i.units_per_pack, 0)) * COALESCE(b.purchase_price_pack, 0), 0) as "totalCostValue",
        ROUND((b.quantity_units_remaining::numeric / NULLIF(i.units_per_pack, 0)) * COALESCE(i.selling_price_pack, 0), 0) as "totalSellingValue",
        CASE 
          WHEN b.expiry_date < CURRENT_DATE THEN 'EXPIRED'
          WHEN b.expiry_date <= (CURRENT_DATE + interval '30 days') THEN 'DAYS_30'
          WHEN b.expiry_date <= (CURRENT_DATE + interval '60 days') THEN 'DAYS_60'
          WHEN b.expiry_date <= (CURRENT_DATE + interval '90 days') THEN 'DAYS_90'
          WHEN b.expiry_date <= (CURRENT_DATE + interval '180 days') THEN 'DAYS_180'
          WHEN b.expiry_date <= (CURRENT_DATE + interval '365 days') THEN 'YEAR_1'
          ELSE 'SAFE'
        END as "expiryTier"
      FROM "${schemaName}".inventory_batches b
      JOIN "${schemaName}".inventory_items i ON b.inventory_item_id = i.id
      LEFT JOIN public.medicines m ON i.medicine_id = m.id
      LEFT JOIN "${schemaName}".suppliers s ON b.supplier_id = s.id
      LEFT JOIN "${schemaName}".purchases p ON b.purchase_id = p.id
      WHERE ${whereClause}
      ORDER BY b.expiry_date ASC;
    `;

    const batches: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);

    // Calculate aggregated metrics by tier
    const tiers: Record<string, { count: number; totalPacks: number; totalCost: number; totalSelling: number; label: string; badgeColor: string }> = {
      EXPIRED: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: 'منتهي الصلاحية', badgeColor: 'rose' },
      DAYS_30: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: 'أقل من 30 يوم', badgeColor: 'red' },
      DAYS_60: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: '31 - 60 يوم', badgeColor: 'orange' },
      DAYS_90: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: '61 - 90 يوم', badgeColor: 'amber' },
      DAYS_180: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: '91 - 180 يوم', badgeColor: 'emerald' },
      YEAR_1: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: '6 - 12 شهر', badgeColor: 'blue' },
      SAFE: { count: 0, totalPacks: 0, totalCost: 0, totalSelling: 0, label: 'أكثر من سنة', badgeColor: 'slate' },
    };

    let totalAtRiskCost = 0;
    let totalAtRiskSelling = 0;
    let totalBatchesAtRisk = 0;

    for (const b of batches) {
      const tierKey = b.expiryTier;
      if (tiers[tierKey]) {
        tiers[tierKey].count += 1;
        tiers[tierKey].totalPacks += Number(b.packsRemaining) || 0;
        tiers[tierKey].totalCost += Number(b.totalCostValue) || 0;
        tiers[tierKey].totalSelling += Number(b.totalSellingValue) || 0;
      }
      if (tierKey !== 'SAFE') {
        totalBatchesAtRisk += 1;
        totalAtRiskCost += Number(b.totalCostValue) || 0;
        totalAtRiskSelling += Number(b.totalSellingValue) || 0;
      }
    }

    const filteredBatches = options?.tier && options.tier !== 'ALL'
      ? batches.filter((b) => b.expiryTier === options.tier)
      : batches;

    return {
      summary: {
        totalBatches: batches.length,
        totalBatchesAtRisk,
        totalAtRiskCost,
        totalAtRiskSelling,
        tiers,
      },
      batches: filteredBatches,
    };
  }

  /**
   * Return near-expiry or defective batch to the supplier and deduct from debt
   */
  async returnBatchToSupplier(batchId: string, dto: ReturnToSupplierDto) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Fetch batch details
        const batchRows: any[] = await tx.$queryRawUnsafe(`
          SELECT 
            b.id,
            b.batch_number as "batchNumber",
            b.quantity_units_remaining as "quantityUnitsRemaining",
            b.purchase_price_pack as "purchasePricePack",
            b.supplier_id as "supplierId",
            b.purchase_id as "purchaseId",
            b.expiry_date as "expiryDate",
            i.units_per_pack as "unitsPerPack",
            COALESCE(i.custom_name, m.trade_name) as "tradeName",
            s.name as "supplierName"
          FROM "${schemaName}".inventory_batches b
          JOIN "${schemaName}".inventory_items i ON b.inventory_item_id = i.id
          LEFT JOIN public.medicines m ON i.medicine_id = m.id
          LEFT JOIN "${schemaName}".suppliers s ON b.supplier_id = s.id
          WHERE b.id = $1::uuid LIMIT 1;
        `, batchId);

        if (batchRows.length === 0) {
          throw new NotFoundException('التشغيلة المحددة غير موجودة في المخزون');
        }

        const batch = batchRows[0];
        const qtyToReturn = Number(dto.quantityUnits);

        if (qtyToReturn > batch.quantityUnitsRemaining) {
          throw new BadRequestException(`الكمية المراد إرجاعها (${qtyToReturn} وحدة) أكبر من المتوفر في الوجبة (${batch.quantityUnitsRemaining} وحدة)`);
        }

        const unitsPerPack = batch.unitsPerPack || 1;
        const packsReturned = qtyToReturn / unitsPerPack;
        const unitPrice = dto.unitRefundPrice !== undefined ? Number(dto.unitRefundPrice) : (batch.purchasePricePack / unitsPerPack);
        const refundTotal = Math.round(qtyToReturn * unitPrice);

        // 2. Deduct returned units from inventory batch
        await tx.$executeRawUnsafe(`
          UPDATE "${schemaName}".inventory_batches
          SET quantity_units_remaining = quantity_units_remaining - $1
          WHERE id = $2::uuid;
        `, qtyToReturn, batchId);

        const voucherNumber = `RET-SUPP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const reason = dto.reason || 'إرجاع دواء للمذخر بسبب قرب انتهاء الصلاحية';

        // 3. Record supplier ledger adjustment if supplier exists
        if (batch.supplierId) {
          // Record credit voucher in supplier_payments
          await tx.$executeRawUnsafe(`
            INSERT INTO "${schemaName}".supplier_payments (
              id, supplier_id, purchase_id, amount, payment_date, payment_method, receipt_number, notes, created_at
            ) VALUES (
              gen_random_uuid(), $1::uuid, $2::uuid, $3, CURRENT_DATE, 'RETURN_CREDIT', $4, $5, NOW()
            );
          `,
            batch.supplierId,
            batch.purchaseId || null,
            refundTotal,
            voucherNumber,
            `سند إرجاع مواد للمذخر رقم ${voucherNumber} - دواء: ${batch.tradeName} (وجبة: ${batch.batchNumber}) - ${reason}`
          );

          // Deduct refund from unpaid purchases/invoices via FIFO:
          const unpaidPurchases: any[] = await tx.$queryRawUnsafe(
            `SELECT id, remaining_amount, paid_amount
             FROM "${schemaName}".purchases
             WHERE supplier_id = $1::uuid AND remaining_amount > 0
             ORDER BY CASE WHEN id = $2::uuid THEN 0 ELSE 1 END, created_at ASC`,
            batch.supplierId,
            batch.purchaseId || '00000000-0000-0000-0000-000000000000',
          );

          let remainingRefundToDeduct = refundTotal;
          for (const p of unpaidPurchases) {
            if (remainingRefundToDeduct <= 0) break;
            const pRem = Number(p.remaining_amount || 0);
            const deductAmt = Math.min(remainingRefundToDeduct, pRem);
            const newRem = pRem - deductAmt;
            const newStatus = newRem === 0 ? 'PAID' : 'PARTIAL';

            await tx.$executeRawUnsafe(`
              UPDATE "${schemaName}".purchases
              SET remaining_amount = $1, payment_status = $2
              WHERE id = $3::uuid;
            `, newRem, newStatus, p.id);

            try {
              await tx.$executeRawUnsafe(`
                UPDATE "${schemaName}".purchase_invoices
                SET remaining_amount = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2::uuid;
              `, newRem, p.id);
            } catch {}

            remainingRefundToDeduct -= deductAmt;
          }
        }

        return {
          success: true,
          message: `تم إرجاع ${packsReturned} علبة من الدواء (${batch.tradeName}) بنجاح وخصم مبلغ (${refundTotal.toLocaleString()} د.ع) من حساب المذخر`,
          voucher: {
            voucherNumber,
            date: new Date().toISOString().slice(0, 10),
            supplierName: batch.supplierName || 'المذخر الأصلي',
            tradeName: batch.tradeName,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            returnedUnits: qtyToReturn,
            returnedPacks: packsReturned,
            unitRefundPrice: unitPrice,
            refundTotal,
            reason,
          },
        };
      },
      {
        maxWait: 15000,
        timeout: 45000,
      }
    );
  }

  /**
   * Get Shortages and Reorder List grouped by Supplier with 3-tier severity
   * (OUT_OF_STOCK, AT_MINIMUM, NEAR_MINIMUM)
   */
  async getShortagesBySupplier(query?: { supplierId?: string; severity?: string }) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensurePurchaseTablesExist(schemaName);

    // 1. Query all inventory items with their latest supplier and purchase details
    const sql = `
      WITH item_stock AS (
        SELECT 
          i.id as "inventoryItemId",
          i.medicine_id as "medicineId",
          COALESCE(i.custom_name, m.trade_name) as "tradeName",
          m.scientific_name as "scientificName",
          m.dosage_form as "dosageForm",
          m.strength as "strength",
          m.barcode as "barcode",
          i.shelf_location as "shelfLocation",
          COALESCE(i.units_per_pack, m.default_units_per_pack, 1) as "unitsPerPack",
          COALESCE(i.min_alert_units, 5) as "minAlertUnits",
          COALESCE(i.selling_price_pack, 0) as "sellingPricePack",
          COALESCE(i.selling_price_unit, 0) as "sellingPriceUnit",
          COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
          -- Latest Batch info for supplier & purchase price
          (
            SELECT b_last.supplier_id 
            FROM "${schemaName}".inventory_batches b_last 
            WHERE b_last.inventory_item_id = i.id 
            ORDER BY b_last.created_at DESC 
            LIMIT 1
          ) as "lastSupplierId",
          (
            SELECT COALESCE(b_last.purchase_price_pack, 0) 
            FROM "${schemaName}".inventory_batches b_last 
            WHERE b_last.inventory_item_id = i.id 
            ORDER BY b_last.created_at DESC 
            LIMIT 1
          ) as "lastPurchasePricePack"
        FROM "${schemaName}".inventory_items i
        LEFT JOIN public.medicines m ON i.medicine_id = m.id
        LEFT JOIN "${schemaName}".inventory_batches b ON i.id = b.inventory_item_id 
          AND b.quantity_units_remaining > 0
          AND b.expiry_date >= CURRENT_DATE 
          AND (b.is_recalled IS FALSE OR b.is_recalled IS NULL)
        GROUP BY i.id, m.id, m.trade_name, m.scientific_name, m.dosage_form, m.strength, m.barcode, m.default_units_per_pack
      )
      SELECT 
        s.*,
        sup.name as "supplierName",
        sup.phone as "supplierPhone"
      FROM item_stock s
      LEFT JOIN "${schemaName}".suppliers sup ON s."lastSupplierId" = sup.id
      ORDER BY s."tradeName" ASC;
    `;

    const rawRows: any[] = await this.prisma.$queryRawUnsafe(sql);

    // 2. Classify items into 3 Severity Tiers
    const shortageItems: any[] = [];
    let outOfStockCount = 0;
    let atMinCount = 0;
    let nearMinCount = 0;

    for (const r of rawRows) {
      const totalUnits = Number(r.totalUnitsRemaining || 0);
      const unitsPerPack = Number(r.unitsPerPack || 1);
      const minAlertUnits = Number(r.minAlertUnits || 5);
      
      // Near minimum threshold: up to 1.8x min_alert_units or + 2 packs
      const nearMinThreshold = Math.max(minAlertUnits * 1.8, minAlertUnits + unitsPerPack * 2);

      let severity: 'OUT_OF_STOCK' | 'AT_MINIMUM' | 'NEAR_MINIMUM' | null = null;
      let severityLabelAr = '';
      let severityRank = 3;

      if (totalUnits === 0) {
        severity = 'OUT_OF_STOCK';
        severityLabelAr = '🔴 نافد تماماً (الرصيد 0)';
        severityRank = 1;
        outOfStockCount++;
      } else if (totalUnits <= minAlertUnits) {
        severity = 'AT_MINIMUM';
        severityLabelAr = '🟠 وصل للحد الأدنى';
        severityRank = 2;
        atMinCount++;
      } else if (totalUnits <= nearMinThreshold) {
        severity = 'NEAR_MINIMUM';
        severityLabelAr = '🟡 قريب من الحد الأدنى';
        severityRank = 3;
        nearMinCount++;
      }

      if (severity) {
        // Suggested Order Packs: target 2.5x minAlertUnits
        const targetUnits = Math.max(minAlertUnits * 2.5, unitsPerPack * 5);
        const shortageUnits = Math.max(0, targetUnits - totalUnits);
        const suggestedPacks = Math.max(1, Math.ceil(shortageUnits / unitsPerPack));

        shortageItems.push({
          id: r.inventoryItemId,
          medicineId: r.medicineId,
          tradeName: r.tradeName,
          scientificName: r.scientificName || '',
          dosageForm: r.dosageForm || '',
          strength: r.strength || '',
          barcode: r.barcode || '',
          shelfLocation: r.shelfLocation || null,
          unitsPerPack,
          minAlertUnits,
          minAlertPacks: Math.ceil(minAlertUnits / unitsPerPack),
          totalUnitsRemaining: totalUnits,
          availablePacks: Math.floor(totalUnits / unitsPerPack),
          availableStrips: totalUnits % unitsPerPack,
          purchasePricePack: Number(r.lastPurchasePricePack || 0),
          sellingPricePack: Number(r.sellingPricePack || 0),
          sellingPriceUnit: Number(r.sellingPriceUnit || 0),
          supplierId: r.lastSupplierId || null,
          supplierName: r.supplierName || 'غير مسجل (بدون مذخر)',
          supplierPhone: r.supplierPhone || null,
          severity,
          severityLabelAr,
          severityRank,
          suggestedOrderPacks: suggestedPacks,
        });
      }
    }

    // Sort by severity rank (OUT_OF_STOCK first, then AT_MINIMUM, then NEAR_MINIMUM)
    shortageItems.sort((a, b) => a.severityRank - b.severityRank || a.tradeName.localeCompare(b.tradeName));

    // Filter by query if provided
    let filteredItems = shortageItems;
    if (query?.supplierId && query.supplierId.trim().length > 0) {
      if (query.supplierId === 'UNASSIGNED') {
        filteredItems = filteredItems.filter(it => !it.supplierId);
      } else {
        filteredItems = filteredItems.filter(it => it.supplierId === query.supplierId);
      }
    }
    if (query?.severity && query.severity !== 'ALL') {
      filteredItems = filteredItems.filter(it => it.severity === query.severity);
    }

    // 3. Group by Supplier
    const supplierGroupsMap = new Map<string, any>();

    for (const item of filteredItems) {
      const key = item.supplierId || 'UNASSIGNED';
      if (!supplierGroupsMap.has(key)) {
        supplierGroupsMap.set(key, {
          supplierId: item.supplierId,
          supplierName: item.supplierName,
          supplierPhone: item.supplierPhone,
          outOfStockCount: 0,
          atMinCount: 0,
          nearMinCount: 0,
          totalItemsCount: 0,
          estimatedTotalCost: 0,
          items: [],
        });
      }

      const grp = supplierGroupsMap.get(key);
      grp.items.push(item);
      grp.totalItemsCount++;
      grp.estimatedTotalCost += item.suggestedOrderPacks * item.purchasePricePack;
      if (item.severity === 'OUT_OF_STOCK') grp.outOfStockCount++;
      else if (item.severity === 'AT_MINIMUM') grp.atMinCount++;
      else if (item.severity === 'NEAR_MINIMUM') grp.nearMinCount++;
    }

    const suppliersList = Array.from(supplierGroupsMap.values());
    suppliersList.sort((a, b) => b.outOfStockCount - a.outOfStockCount || b.totalItemsCount - a.totalItemsCount);

    return {
      summary: {
        totalShortagesCount: shortageItems.length,
        outOfStockCount,
        atMinCount,
        nearMinCount,
        suppliersCount: supplierGroupsMap.size,
      },
      suppliers: suppliersList,
      allItems: filteredItems,
    };
  }
}
