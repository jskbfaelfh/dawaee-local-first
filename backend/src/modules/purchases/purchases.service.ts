import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Injectable()
export class PurchasesService {
  private static readonly verifiedSchemas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Helper to ensure all tables exist in the tenant schema
   */
  private async ensureTablesExist(schemaName: string) {
    if (PurchasesService.verifiedSchemas.has(schemaName)) {
      return;
    }

    try {
      const sqlBlock = `DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS "${schemaName}".suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    company_name VARCHAR(255),
    balance_due DECIMAL(12, 2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS "${schemaName}".purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100),
    supplier_id UUID,
    supplier_name VARCHAR(255),
    total_gross_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    net_total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    due_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS "${schemaName}".purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID,
    inventory_item_id UUID,
    quantity_packs INT NOT NULL,
    bonus_packs INT NOT NULL DEFAULT 0,
    units_per_pack INT NOT NULL DEFAULT 1,
    purchase_price_pack DECIMAL(12, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    net_cost_pack DECIMAL(12, 2) NOT NULL,
    selling_price_pack DECIMAL(12, 2) NOT NULL,
    selling_price_unit DECIMAL(12, 2) NOT NULL,
    expiry_date DATE,
    batch_number VARCHAR(100)
  );
  CREATE TABLE IF NOT EXISTS "${schemaName}".supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID,
    purchase_id UUID,
    amount DECIMAL(12, 2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50) DEFAULT 'CASH',
    receipt_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS "${schemaName}".purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100) NOT NULL,
    supplier_id UUID,
    supplier_name VARCHAR(255),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_amount DECIMAL(12, 2) NOT NULL,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    early_discount_days INT,
    early_discount_percent DECIMAL(5, 2),
    early_discount_deadline DATE,
    early_discount_amount DECIMAL(12, 2),
    early_discount_applied BOOLEAN DEFAULT FALSE,
    early_discount_applied_amount DECIMAL(12, 2) DEFAULT 0,
    notes TEXT,
    items_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS "${schemaName}".purchase_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_invoice_id UUID,
    medicine_id UUID,
    trade_name VARCHAR(255) NOT NULL,
    scientific_name VARCHAR(255),
    batch_number VARCHAR(100),
    expiry_date DATE NOT NULL,
    quantity_packs INT NOT NULL,
    units_per_pack INT NOT NULL DEFAULT 1,
    purchase_price_pack DECIMAL(12, 2) NOT NULL,
    selling_price_pack DECIMAL(12, 2) NOT NULL,
    total_cost DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ALTER TABLE "${schemaName}".inventory_items ADD COLUMN IF NOT EXISTS custom_name VARCHAR(255);
  ALTER TABLE "${schemaName}".inventory_batches ADD COLUMN IF NOT EXISTS supplier_id UUID;
  ALTER TABLE "${schemaName}".inventory_batches ADD COLUMN IF NOT EXISTS purchase_id UUID;
  ALTER TABLE "${schemaName}".inventory_batches ADD COLUMN IF NOT EXISTS is_recalled BOOLEAN DEFAULT FALSE;
  ALTER TABLE "${schemaName}".inventory_batches ADD COLUMN IF NOT EXISTS selling_price_pack DECIMAL(12, 2);
  ALTER TABLE "${schemaName}".inventory_batches ADD COLUMN IF NOT EXISTS selling_price_unit DECIMAL(12, 2);
  ALTER TABLE "${schemaName}".purchase_invoice_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255);
  ALTER TABLE "${schemaName}".suppliers ADD COLUMN IF NOT EXISTS address TEXT;
  ALTER TABLE "${schemaName}".suppliers ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
  ALTER TABLE "${schemaName}".suppliers ADD COLUMN IF NOT EXISTS balance_due DECIMAL(12, 2) DEFAULT 0;
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS early_discount_days INT;
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS early_discount_percent DECIMAL(5, 2);
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS early_discount_deadline DATE;
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS early_discount_amount DECIMAL(12, 2);
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS early_discount_applied_amount DECIMAL(12, 2) DEFAULT 0;
  ALTER TABLE "${schemaName}".purchase_invoices ADD COLUMN IF NOT EXISTS discount_tiers JSONB;
  ALTER TABLE "${schemaName}".purchase_invoice_items ALTER COLUMN expiry_date DROP NOT NULL;
  ALTER TABLE "${schemaName}".purchase_invoice_items ADD COLUMN IF NOT EXISTS bonus_packs INT DEFAULT 0;
  ALTER TABLE "${schemaName}".purchase_invoice_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0;
  ALTER TABLE "${schemaName}".purchase_items ALTER COLUMN expiry_date DROP NOT NULL;
  ALTER TABLE "${schemaName}".inventory_batches ALTER COLUMN expiry_date DROP NOT NULL;
END $$;`;

      await this.prisma.$executeRawUnsafe(sqlBlock);
      PurchasesService.verifiedSchemas.add(schemaName);
    } catch (err: any) {
      // Continue if schema tables exist
      PurchasesService.verifiedSchemas.add(schemaName);
    }
  }

  /**
   * Record a new purchase invoice from a supplier/warehouse into tenant schema
   */
  async createPurchase(tenantId: string, dto: CreatePurchaseDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) {
      throw new BadRequestException('الصيدلية غير متوفرة أو ليس لديها قاعدة بيانات مهيأة');
    }

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    const paidAmount = Number(dto.paidAmount) || 0;
    const totalAmount = Number(dto.totalAmount) || 0;
    const remainingAmount = Math.max(0, totalAmount - paidAmount);
    const invoiceDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const invoiceNumber = (dto.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`).trim();

    // Auto-resolve or create Supplier in tenant schema
    let finalSupplierId = dto.supplierId || null;
    const supplierName = (dto.supplierName || 'مذخر أدوية').trim();

    if (!finalSupplierId && supplierName) {
      const existingSupp: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT id FROM "${schema}"."suppliers" WHERE LOWER(name) = LOWER($1) LIMIT 1;
      `, supplierName);

      if (existingSupp.length > 0) {
        finalSupplierId = existingSupp[0].id;
      } else {
        const createdSupp: any[] = await this.prisma.$queryRawUnsafe(`
          INSERT INTO "${schema}"."suppliers" ("name")
          VALUES ($1)
          RETURNING id;
        `, supplierName);
        finalSupplierId = createdSupp[0].id;
      }
    }

    const purchaseId = crypto.randomUUID();
    const paymentStatus = remainingAmount === 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

    const earlyDiscountDays = dto.earlyDiscountDays ? Number(dto.earlyDiscountDays) : null;
    const earlyDiscountPercent = dto.earlyDiscountPercent ? Number(dto.earlyDiscountPercent) : null;
    let earlyDiscountDeadline: Date | null = null;
    let earlyDiscountAmount: number | null = null;

    if (earlyDiscountDays && earlyDiscountDays > 0 && earlyDiscountPercent && earlyDiscountPercent > 0) {
      earlyDiscountDeadline = new Date(invoiceDate.getTime() + earlyDiscountDays * 24 * 60 * 60 * 1000);
      earlyDiscountAmount = Math.round(totalAmount * (earlyDiscountPercent / 100));
    }

    const totalGrossAmount = dto.items.reduce((sum: number, it: any) => sum + (Number(it.quantityPacks) || 0) * (Number(it.purchasePricePack) || 0), 0);
    const totalDiscountAmount = Math.max(0, totalGrossAmount - totalAmount);

    // 1. Insert into purchases table (standard unified system)
    await this.prisma.$executeRawUnsafe(`
      INSERT INTO "${schema}"."purchases" (
        "id", "invoice_number", "supplier_id", "supplier_name",
        "total_gross_amount", "total_discount_amount", "net_total_amount",
        "paid_amount", "remaining_amount", "payment_status", "notes", "created_at"
      ) VALUES (
        $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12
      );
    `,
      purchaseId,
      invoiceNumber,
      finalSupplierId,
      supplierName,
      totalGrossAmount,
      totalDiscountAmount,
      totalAmount,
      paidAmount,
      remainingAmount,
      paymentStatus,
      dto.notes || null,
      invoiceDate
    );

    // 2. Insert into purchase_invoices table for multi-view compatibility
    const discountTiersJson = dto.discountTiers && Array.isArray(dto.discountTiers) && dto.discountTiers.length > 0
      ? JSON.stringify(dto.discountTiers)
      : null;

    const invoiceInsert = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      INSERT INTO "${schema}"."purchase_invoices" (
        "id", "invoice_number", "supplier_id", "supplier_name", "invoice_date",
        "total_amount", "paid_amount", "remaining_amount", "notes", "items_count",
        "early_discount_days", "early_discount_percent", "early_discount_deadline", "early_discount_amount", "discount_tiers"
      ) VALUES (
        $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
      ) RETURNING id;
    `,
      purchaseId,
      invoiceNumber,
      finalSupplierId,
      supplierName,
      invoiceDate,
      totalAmount,
      paidAmount,
      remainingAmount,
      dto.notes || null,
      dto.items.length,
      earlyDiscountDays,
      earlyDiscountPercent,
      earlyDiscountDeadline,
      earlyDiscountAmount,
      discountTiersJson
    );

    const invoiceId = invoiceInsert[0].id;

    const processedMedicineIds: string[] = [];

    // 3. Process items, create medicines if needed, update inventory items & insert batches
    for (const item of dto.items) {
      const quantityPacks = Number(item.quantityPacks) || 1;
      const bonusPacks = Number(item.bonusPacks) || 0;
      const purchasePricePack = Number(item.purchasePricePack) || 0;
      const discountPercent = Number(item.discountPercent) || 0;
      const netCostPack = purchasePricePack * (1 - discountPercent / 100);
      const unitsPerPack = Number(item.unitsPerPack) || 1;
      const sellingPricePack = Number(item.sellingPricePack) || 0;
      const sellingPriceUnit = unitsPerPack > 0 ? (sellingPricePack / unitsPerPack) : sellingPricePack;
      const totalCost = quantityPacks * netCostPack;
      const totalPacks = quantityPacks + bonusPacks;
      const effectiveNetCostPack = totalPacks > 0
        ? Number((totalCost / totalPacks).toFixed(2))
        : netCostPack;
      const totalUnits = Math.round(totalPacks * unitsPerPack);

      let expiryDate: Date | null = null;
      if (item.expiryDate && String(item.expiryDate).trim() && String(item.expiryDate).trim() !== 'null') {
        const d = new Date(item.expiryDate);
        if (!isNaN(d.getTime())) expiryDate = d;
      }

      const batchNumber = (item.batchNumber && String(item.batchNumber).trim() && String(item.batchNumber).trim() !== 'null')
        ? String(item.batchNumber).trim()
        : `BN-${Date.now().toString().slice(-4)}`;

      const finalTradeName = (item.customTradeName || item.tradeName || 'دواء جديد').trim();

      // Ensure medicine exists in public.medicines
      let medicineId = item.medicineId;
      if (medicineId) {
        const check = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM public.medicines WHERE id = $1::uuid LIMIT 1;`,
          medicineId,
        );
        if (check.length === 0) {
          medicineId = undefined;
        }
      }

      if (!medicineId) {
        const existingMed: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT id FROM public.medicines 
          WHERE trade_name ILIKE $1 OR (barcode IS NOT NULL AND barcode = $2)
          LIMIT 1;
        `, finalTradeName, item.barcode || '__NO_BARCODE__');

        if (existingMed.length > 0) {
          medicineId = existingMed[0].id;
        } else {
          const createdMed: any[] = await this.prisma.$queryRawUnsafe(`
            INSERT INTO public.medicines (
              "id", "trade_name", "scientific_name", "barcode", "default_units_per_pack", "is_verified"
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, false
            ) RETURNING id;
          `,
            finalTradeName,
            item.scientificName || finalTradeName,
            item.barcode || null,
            unitsPerPack
          );
          medicineId = createdMed[0].id;
        }
      }

      if (medicineId) {
        processedMedicineIds.push(medicineId);
      }

      // Find or create InventoryItem in Tenant schema
      let inventoryItem = (
        await this.prisma.$queryRawUnsafe<Array<{
          id: string;
          units_per_pack: number;
          selling_price_pack: number;
          selling_price_unit: number;
          shelf_location: string | null;
        }>>(`
          SELECT id, units_per_pack, selling_price_pack, selling_price_unit, shelf_location 
          FROM "${schema}"."inventory_items" 
          WHERE "medicine_id" = $1::uuid LIMIT 1;
        `, medicineId)
      )[0];

      let inventoryItemId: string;

      // Resolve autofill values from previous pharmacy records if not passed or 0
      const resolvedUnits = Number(
        unitsPerPack > 1 ? unitsPerPack : inventoryItem?.units_per_pack || 1,
      );
      const resolvedSellingPack = Number(
        sellingPricePack > 0 ? sellingPricePack : inventoryItem?.selling_price_pack || 0,
      );
      let resolvedSellingUnit = Number(
        sellingPriceUnit > 0 ? sellingPriceUnit : inventoryItem?.selling_price_unit || 0,
      );
      if (resolvedSellingUnit <= 0 && resolvedSellingPack > 0 && resolvedUnits > 0) {
        resolvedSellingUnit = Math.round(resolvedSellingPack / resolvedUnits);
      }
      const resolvedShelf =
        item.shelfLocation && item.shelfLocation.trim().length > 0
          ? item.shelfLocation.trim()
          : inventoryItem?.shelf_location || null;

      let resolvedExpiryDate: Date | null = expiryDate;
      if (!resolvedExpiryDate && inventoryItem) {
        try {
          const lastBatches = await this.prisma.$queryRawUnsafe<Array<{ expiry_date: Date }>>(`
            SELECT expiry_date FROM "${schema}"."inventory_batches"
            WHERE inventory_item_id = $1::uuid
            ORDER BY created_at DESC LIMIT 1;
          `, inventoryItem.id);
          if (lastBatches.length > 0 && lastBatches[0].expiry_date) {
            resolvedExpiryDate = new Date(lastBatches[0].expiry_date);
          }
        } catch {}
      }

      if (!inventoryItem) {
        const createdInv = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`
          INSERT INTO "${schema}"."inventory_items" (
            "medicine_id", "custom_name", "units_per_pack", "selling_price_pack", "selling_price_unit", "min_alert_units", "is_public_visible", "shelf_location"
          ) VALUES (
            $1::uuid, $2, $3, $4, $5, 5, true, $6
          ) RETURNING id;
        `, medicineId, finalTradeName, resolvedUnits, resolvedSellingPack, resolvedSellingUnit, resolvedShelf);
        inventoryItemId = createdInv[0].id;
      } else {
        inventoryItemId = inventoryItem.id;
        // Update price, units, and shelf
        await this.prisma.$executeRawUnsafe(`
          UPDATE "${schema}"."inventory_items"
          SET "selling_price_pack" = CASE WHEN $1 > 0 THEN $1 ELSE "selling_price_pack" END,
              "selling_price_unit" = CASE WHEN $2 > 0 THEN $2 ELSE "selling_price_unit" END,
              "units_per_pack" = CASE WHEN $3 > 1 THEN $3 ELSE "units_per_pack" END,
              "custom_name" = COALESCE($4, "custom_name"),
              "shelf_location" = COALESCE($5, "shelf_location"),
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = $6::uuid;
        `, resolvedSellingPack, resolvedSellingUnit, resolvedUnits, finalTradeName, resolvedShelf, inventoryItemId);
      }

      const totalBatchUnits = (quantityPacks + bonusPacks) * resolvedUnits;

      // Insert into purchase_items
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO "${schema}"."purchase_items" (
          "purchase_id", "inventory_item_id", "quantity_packs", "bonus_packs", "units_per_pack",
          "purchase_price_pack", "discount_percent", "net_cost_pack", "selling_price_pack", "selling_price_unit",
          "expiry_date", "batch_number"
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        );
      `,
        purchaseId,
        inventoryItemId,
        quantityPacks,
        bonusPacks,
        resolvedUnits,
        purchasePricePack,
        discountPercent,
        netCostPack,
        resolvedSellingPack,
        resolvedSellingUnit,
        resolvedExpiryDate,
        batchNumber
      );

      // Insert into purchase_invoice_items
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO "${schema}"."purchase_invoice_items" (
          "purchase_invoice_id", "medicine_id", "trade_name", "scientific_name",
          "batch_number", "expiry_date", "quantity_packs", "bonus_packs", "units_per_pack",
          "purchase_price_pack", "discount_percent", "selling_price_pack", "total_cost"
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        );
      `,
        invoiceId,
        medicineId,
        finalTradeName,
        item.scientificName || null,
        batchNumber,
        resolvedExpiryDate,
        quantityPacks,
        bonusPacks,
        resolvedUnits,
        purchasePricePack,
        discountPercent,
        resolvedSellingPack,
        totalCost
      );

      // Add Batch to Inventory
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO "${schema}"."inventory_batches" (
          "inventory_item_id", "supplier_id", "purchase_id", "batch_number", "purchase_price_pack",
          "selling_price_pack", "selling_price_unit", "quantity_units_remaining", "expiry_date", "is_recalled"
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, FALSE
        );
      `,
        inventoryItemId,
        finalSupplierId,
        purchaseId,
        batchNumber,
        effectiveNetCostPack,
        resolvedSellingPack,
        resolvedSellingUnit,
        totalBatchUnits,
        resolvedExpiryDate
      );
    }

    // 4. Record payment in supplier_payments if paidAmount > 0
    if (paidAmount > 0 && finalSupplierId) {
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO "${schema}"."supplier_payments" (
          "supplier_id", "purchase_id", "amount", "payment_date", "payment_method", "receipt_number", "notes"
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, 'CASH', $5, $6
        );
      `,
        finalSupplierId,
        purchaseId,
        paidAmount,
        invoiceDate,
        invoiceNumber,
        `دفعة مسددة عند استلام فاتورة ${invoiceNumber}`
      );
    }

    // 5. Emit background sync event to update CentralSearchIndex for Public Search
    if (processedMedicineIds.length > 0) {
      this.eventEmitter.emit('inventory.synced', {
        tenantId,
        schemaName: schema,
        medicineIds: Array.from(new Set(processedMedicineIds)),
      });
    }

    return {
      message: 'تم تسجيل فاتورة الشراء وتحديث المخزون والوجبات بنجاح',
      invoiceId,
      invoiceNumber,
      totalAmount,
      itemsCount: dto.items.length,
    };
  }

  /**
   * Get purchase invoices history with supplier details and items summary
   */
  async getPurchases(tenantId: string, search?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) {
      throw new BadRequestException('الصيدلية غير متوفرة');
    }

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    let query = `
      SELECT 
        pi.id,
        pi.invoice_number as "invoiceNumber",
        pi.supplier_id as "supplierId",
        pi.supplier_name as "supplierName",
        pi.invoice_date as "invoiceDate",
        COALESCE(p.net_total_amount, pi.total_amount) as "totalAmount",
        COALESCE(p.paid_amount, pi.paid_amount) as "paidAmount",
        COALESCE(p.remaining_amount, pi.remaining_amount) as "remainingAmount",
        pi.notes,
        pi.items_count as "itemsCount",
        pi.early_discount_days as "earlyDiscountDays",
        pi.early_discount_percent as "earlyDiscountPercent",
        pi.early_discount_deadline as "earlyDiscountDeadline",
        pi.early_discount_amount as "earlyDiscountAmount",
        pi.early_discount_applied as "earlyDiscountApplied",
        pi.early_discount_applied_amount as "earlyDiscountAppliedAmount",
        pi.created_at as "createdAt"
      FROM "${schema}"."purchase_invoices" pi
      LEFT JOIN "${schema}"."purchases" p ON pi.id = p.id
    `;

    const params: any[] = [];
    if (search && search.trim()) {
      query += ` WHERE pi.invoice_number ILIKE $1 OR pi.supplier_name ILIKE $1`;
      params.push(`%${search.trim()}%`);
    }

    query += ` ORDER BY pi.created_at DESC LIMIT 100;`;

    return this.prisma.$queryRawUnsafe(query, ...params);
  }

  /**
   * Get single purchase invoice details including all items
   */
  async getPurchaseById(tenantId: string, id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) {
      throw new BadRequestException('الصيدلية غير متوفرة');
    }

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    const invoices = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        pi.id,
        pi.invoice_number as "invoiceNumber",
        pi.supplier_id as "supplierId",
        pi.supplier_name as "supplierName",
        pi.invoice_date as "invoiceDate",
        COALESCE(p.net_total_amount, pi.total_amount) as "totalAmount",
        COALESCE(p.paid_amount, pi.paid_amount) as "paidAmount",
        COALESCE(p.remaining_amount, pi.remaining_amount) as "remainingAmount",
        pi.notes,
        pi.items_count as "itemsCount",
        pi.early_discount_days as "earlyDiscountDays",
        pi.early_discount_percent as "earlyDiscountPercent",
        pi.early_discount_deadline as "earlyDiscountDeadline",
        pi.early_discount_amount as "earlyDiscountAmount",
        pi.early_discount_applied as "earlyDiscountApplied",
        pi.early_discount_applied_amount as "earlyDiscountAppliedAmount",
        pi.created_at as "createdAt"
      FROM "${schema}"."purchase_invoices" pi
      LEFT JOIN "${schema}"."purchases" p ON pi.id = p.id
      WHERE pi.id = $1::uuid;
    `, id);

    if (!invoices || invoices.length === 0) {
      throw new NotFoundException('فاتورة الشراء غير موجودة');
    }

    const invoice = invoices[0];

    const items = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        pii.id,
        pii.medicine_id as "medicineId",
        pii.trade_name as "tradeName",
        pii.scientific_name as "scientificName",
        pii.batch_number as "batchNumber",
        pii.expiry_date as "expiryDate",
        pii.quantity_packs as "quantityPacks",
        pii.units_per_pack as "unitsPerPack",
        pii.purchase_price_pack as "purchasePricePack",
        pii.selling_price_pack as "sellingPricePack",
        pii.total_cost as "totalCost"
      FROM "${schema}"."purchase_invoice_items" pii
      WHERE pii.purchase_invoice_id = $1::uuid
      ORDER BY pii.trade_name ASC;
    `, id);

    return {
      ...invoice,
      items,
    };
  }

  /**
   * Apply early settlement discount to a purchase invoice
   */
  async applyEarlyDiscount(tenantId: string, invoiceId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) {
      throw new BadRequestException('الصيدلية غير متوفرة');
    }

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    const invoices = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT * FROM "${schema}"."purchase_invoices" WHERE id = $1::uuid;
    `, invoiceId);

    if (!invoices || invoices.length === 0) {
      throw new NotFoundException('فاتورة الشراء غير موجودة');
    }

    const inv = invoices[0];
    if (inv.early_discount_applied) {
      throw new BadRequestException('تم تطبيق خصم التسديد المبكر لهذه الفاتورة مسبقاً');
    }

    const totalAmount = Number(inv.total_amount) || 0;
    const remainingAmount = Number(inv.remaining_amount) || 0;
    let discountAmount = Number(inv.early_discount_amount);

    if (!discountAmount || discountAmount <= 0) {
      const pct = Number(inv.early_discount_percent) || 0;
      discountAmount = Math.round(totalAmount * (pct / 100));
    }

    if (discountAmount <= 0) {
      throw new BadRequestException('لا توجد نسبة خصم تسديد مبكر محددة لهذه الفاتورة');
    }

    const newRemaining = Math.max(0, remainingAmount - discountAmount);

    await this.prisma.$executeRawUnsafe(`
      UPDATE "${schema}"."purchase_invoices"
      SET 
        early_discount_applied = TRUE,
        early_discount_applied_amount = $1,
        remaining_amount = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3::uuid;
    `, discountAmount, newRemaining, invoiceId);

    // Also update purchases table if exists
    try {
      await this.prisma.$executeRawUnsafe(`
        UPDATE "${schema}"."purchases"
        SET 
          remaining_amount = $1,
          payment_status = CASE WHEN $1 <= 0 THEN 'PAID' ELSE 'PARTIAL' END
        WHERE id = $2::uuid;
      `, newRemaining, invoiceId);
    } catch (err) {
      // Ignore if table mismatch
    }

    return {
      success: true,
      message: `تم تطبيق خصم التسديد المبكر بقيمة (${discountAmount.toLocaleString()} د.ع) وتخفيض الدين إلى (${newRemaining.toLocaleString()} د.ع)`,
      discountAmount,
      newRemainingAmount: newRemaining,
    };
  }

  /**
   * Get active early discount alerts for upcoming invoice deadlines
   */
  async getEarlyDiscountAlerts(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) {
      return [];
    }

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    const alerts = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        pi.id,
        pi.invoice_number as "invoiceNumber",
        pi.supplier_name as "supplierName",
        pi.total_amount as "totalAmount",
        pi.remaining_amount as "remainingAmount",
        pi.early_discount_days as "earlyDiscountDays",
        pi.early_discount_percent as "earlyDiscountPercent",
        pi.early_discount_deadline as "earlyDiscountDeadline",
        pi.early_discount_amount as "earlyDiscountAmount",
        (pi.early_discount_deadline::date - CURRENT_DATE) as "daysRemaining"
      FROM "${schema}"."purchase_invoices" pi
      WHERE pi.remaining_amount > 0
        AND (pi.early_discount_applied IS FALSE OR pi.early_discount_applied IS NULL)
        AND pi.early_discount_deadline IS NOT NULL
        AND pi.early_discount_deadline >= CURRENT_DATE
      ORDER BY pi.early_discount_deadline ASC
      LIMIT 20;
    `);

    return alerts;
  }
}
