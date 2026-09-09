import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CheckoutDto, CreateReturnDto, SyncOfflineSalesDto, UnitTypeEnum, ItemConditionEnum } from './dto/create-sale.dto';
import { validateAndSanitizeSchemaName } from '../../common/utils/security.util';

export interface ReturnAllocation {
  batchId: string;
  batchNumber: string;
  units: number;
  unitPrice: number;
  costPricePack?: number;
  costPriceUnit?: number;
}

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);
  private static verifiedReturnSchemas = new Set<string>();
  private static verifiedSaleSchemas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Helper to ensure sale and cost snapshot columns exist in the tenant schema
   */
  private async ensureSaleColumnsExist(schemaName: string) {
    if (PosService.verifiedSaleSchemas.has(schemaName)) return;
    try {
      await this.prisma.$executeRawUnsafe(`
        DO $$ 
        BEGIN
          ALTER TABLE "${schemaName}".sales ADD COLUMN IF NOT EXISTS offline_id VARCHAR(100);
          CREATE UNIQUE INDEX IF NOT EXISTS "idx_${schemaName}_sales_offline_id" 
            ON "${schemaName}".sales (offline_id) WHERE offline_id IS NOT NULL;
          ALTER TABLE "${schemaName}".sale_items ADD COLUMN IF NOT EXISTS cost_price_pack DECIMAL(12, 2) DEFAULT 0;
          ALTER TABLE "${schemaName}".sale_items ADD COLUMN IF NOT EXISTS cost_price_unit DECIMAL(12, 2) DEFAULT 0;
          ALTER TABLE "${schemaName}".sale_items ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12, 2) DEFAULT 0;
        END $$;
      `);
      PosService.verifiedSaleSchemas.add(schemaName);
    } catch (err: any) {
      this.logger.warn(`Could not verify sale columns for ${schemaName}: ${err.message}`);
    }
  }

  /**
   * Helper to ensure return and cost columns exist in the tenant schema
   */
  private async ensureReturnColumnsExist(schemaName: string) {
    if (PosService.verifiedReturnSchemas.has(schemaName)) return;
    try {
      await this.prisma.$executeRawUnsafe(`
        DO $$ 
        BEGIN
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS inventory_batch_id UUID;
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS item_condition VARCHAR(20) DEFAULT 'RESALEABLE';
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'CASH';
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS user_name VARCHAR(150);
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS notes TEXT;
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255);
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12, 2) DEFAULT 0;
          ALTER TABLE "${schemaName}".returns ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12, 2) DEFAULT 0;
        END $$;
      `);
      PosService.verifiedReturnSchemas.add(schemaName);
    } catch (err: any) {
      this.logger.warn(`Could not verify return columns for ${schemaName}: ${err.message}`);
    }
  }

  /**
   * Generate Invoice Number with high entropy: INV-YYYYMMDD-HHMMSS-XXXXXXXXXX
   * Combines exact date, UTC time (to the second), and 5 bytes (10 hex chars) of CSPRNG.
   * Provides 1,099,511,627,776 combinations per second, completely eliminating collision risk.
   */
  private generateInvoiceNumber(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = String(now.getUTCHours()).padStart(2, '0') +
                    String(now.getUTCMinutes()).padStart(2, '0') +
                    String(now.getUTCSeconds()).padStart(2, '0');
    const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `INV-${dateStr}-${timeStr}-${rand}`;
  }

  /**
   * Process Checkout / Sale with FEFO inventory deduction, negative stock allowance, and offlineId idempotency
   */
  async checkout(dto: CheckoutDto) {
    const rawSchema = this.tenantContext.getSchemaName();
    const schemaName = validateAndSanitizeSchemaName(rawSchema);
    const tenantId = this.tenantContext.getTenantId();
    const ctx = this.tenantContext.getContext();
    const userId = ctx?.userId;

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('سلة المشتريات فارغة');
    }

    await this.ensureSaleColumnsExist(schemaName);

    // 1. Idempotent deduplication check for offline sales
    if (dto.offlineId && dto.offlineId.trim()) {
      const cleanOfflineId = dto.offlineId.trim();
      const existingSale = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, invoice_number as "invoiceNumber", subtotal, discount_amount as "discountAmount", 
                total_amount as "totalAmount", created_at as "createdAt", offline_id as "offlineId"
         FROM "${schemaName}".sales 
         WHERE offline_id = $1::text LIMIT 1`,
        cleanOfflineId,
      );

      if (existingSale && existingSale.length > 0) {
        this.logger.warn(`Idempotent sale hit for offlineId: ${cleanOfflineId}. Returning existing record without duplicate stock deduction.`);
        const sale = existingSale[0];
        const items = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT id, sale_id as "saleId", inventory_item_id as "inventoryItemId", 
                  inventory_batch_id as "inventoryBatchId", unit_type as "unitType", 
                  quantity, unit_price as "unitPrice", total_price as "totalPrice"
           FROM "${schemaName}".sale_items 
           WHERE sale_id = $1::uuid`,
          sale.id,
        );

        return {
          ...sale,
          items,
          isIdempotentReplay: true,
        };
      }
    }

    // 2. Validate & sort item IDs deterministically to eliminate deadlocks across concurrent checkouts
    const rawItemIds = Array.from(new Set(dto.items.map((i) => i.inventoryItemId)));
    for (const id of rawItemIds) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new BadRequestException('معرف مادة غير صالح');
      }
    }
    const itemIds = rawItemIds.sort();

    let invoiceNumber = this.generateInvoiceNumber();
    let saleId = crypto.randomUUID();
    let transactionResult: any = null;

    // 3. Execute checkout inside an ACID Transaction with Row-Level Locking and Retry for collision resilience
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        transactionResult = await this.prisma.$transaction(
          async (tx) => {
            // A. Fetch and acquire exclusive row locks (FOR UPDATE) on inventory_items in deterministic order
            const itemRows: any[] = await tx.$queryRawUnsafe(
              `SELECT id, medicine_id, units_per_pack, selling_price_pack, selling_price_unit 
               FROM "${schemaName}".inventory_items 
               WHERE id = ANY($1::uuid[])
               ORDER BY id ASC
               FOR UPDATE`,
              itemIds,
            );

            const itemMap = new Map<string, any>();
            for (const row of itemRows) {
              itemMap.set(row.id, row);
            }

            // B. Fetch and acquire exclusive row locks (FOR UPDATE) on all active inventory batches
            const batchesRows: any[] = await tx.$queryRawUnsafe(
              `SELECT id, inventory_item_id, quantity_units_remaining, purchase_price_pack, selling_price_pack, selling_price_unit, expiry_date 
               FROM "${schemaName}".inventory_batches 
               WHERE inventory_item_id = ANY($1::uuid[]) 
                 AND expiry_date >= CURRENT_DATE
                 AND (is_recalled IS FALSE OR is_recalled IS NULL)
               ORDER BY inventory_item_id ASC, expiry_date ASC, id ASC
               FOR UPDATE`,
              itemIds,
            );

            const batchesByItemMap = new Map<string, any[]>();
            for (const b of batchesRows) {
              const list = batchesByItemMap.get(b.inventory_item_id) || [];
              list.push(b);
              batchesByItemMap.set(b.inventory_item_id, list);
            }

            let subtotal = 0;
            const lineItemsToInsert: any[] = [];
            const affectedMedicineIds: string[] = [];

            // C. FEFO Allocation loop with atomic row updates
            for (const item of dto.items) {
              const invItem = itemMap.get(item.inventoryItemId);
              if (!invItem) {
                throw new NotFoundException(`المادة ${item.inventoryItemId} غير متوفرة في مخزون الصيدلية`);
              }

              if (invItem.medicine_id) {
                affectedMedicineIds.push(invItem.medicine_id);
              }

              const unitsPerPack = Number(invItem.units_per_pack) || 1;
              const isPack = item.unitType === UnitTypeEnum.PACK;
              const unitsToDeduct = isPack ? item.quantity * unitsPerPack : item.quantity;
              let unitsLeftToDeduct = unitsToDeduct;

              const defaultPackPrice = Number(invItem.selling_price_pack) || 0;
              const defaultUnitPrice = Number(invItem.selling_price_unit) || (unitsPerPack > 0 ? defaultPackPrice / unitsPerPack : 0);

              const availableBatches = batchesByItemMap.get(item.inventoryItemId) || [];

              for (const batch of availableBatches) {
                if (unitsLeftToDeduct <= 0) break;
                const batchRemaining = Number(batch.quantity_units_remaining);
                if (batchRemaining <= 0) continue;

                const deductionFromThisBatch = Math.min(unitsLeftToDeduct, batchRemaining);

                await tx.$executeRawUnsafe(
                  `UPDATE "${schemaName}".inventory_batches 
                   SET quantity_units_remaining = quantity_units_remaining - $1 
                   WHERE id = $2::uuid`,
                  deductionFromThisBatch,
                  batch.id,
                );

                batch.quantity_units_remaining = batchRemaining - deductionFromThisBatch;
                unitsLeftToDeduct -= deductionFromThisBatch;

                const batchPackPrice = batch.selling_price_pack != null ? Number(batch.selling_price_pack) : defaultPackPrice;
                const batchUnitPrice = batch.selling_price_unit != null ? Number(batch.selling_price_unit) : defaultUnitPrice;

                const allocatedQty = isPack ? Math.round((deductionFromThisBatch / unitsPerPack) * 100) / 100 : deductionFromThisBatch;
                const priceApplied = isPack ? batchPackPrice : batchUnitPrice;
                const lineTotal = priceApplied * allocatedQty;

                const costPricePack = Number(batch.purchase_price_pack) || 0;
                const costPriceUnit = unitsPerPack > 0 ? costPricePack / unitsPerPack : costPricePack;
                const lineCost = isPack ? costPricePack * allocatedQty : costPriceUnit * allocatedQty;

                subtotal += lineTotal;

                lineItemsToInsert.push({
                  id: crypto.randomUUID(),
                  saleId,
                  inventoryItemId: item.inventoryItemId,
                  inventoryBatchId: batch.id,
                  unitType: item.unitType,
                  quantity: allocatedQty,
                  unitPrice: priceApplied,
                  totalPrice: lineTotal,
                  costPricePack,
                  costPriceUnit,
                  totalCost: lineCost,
                });
              }

              // Negative Stock / Deficit Handling
              if (unitsLeftToDeduct > 0) {
                this.logger.warn(
                  `Negative stock allowance triggered for Item ${item.inventoryItemId}. Deficit: ${unitsLeftToDeduct} units.`
                );

                if (availableBatches.length > 0) {
                  const latestBatch = availableBatches[availableBatches.length - 1];
                  await tx.$executeRawUnsafe(
                    `UPDATE "${schemaName}".inventory_batches 
                     SET quantity_units_remaining = quantity_units_remaining - $1 
                     WHERE id = $2::uuid`,
                    unitsLeftToDeduct,
                    latestBatch.id,
                  );

                  const latestPackPrice = latestBatch.selling_price_pack != null ? Number(latestBatch.selling_price_pack) : defaultPackPrice;
                  const latestUnitPrice = latestBatch.selling_price_unit != null ? Number(latestBatch.selling_price_unit) : defaultUnitPrice;

                  const deficitQty = isPack ? Math.round((unitsLeftToDeduct / unitsPerPack) * 100) / 100 : unitsLeftToDeduct;
                  const deficitUnitPrice = isPack ? latestPackPrice : latestUnitPrice;
                  const deficitLineTotal = deficitUnitPrice * deficitQty;

                  const deficitCostPack = Number(latestBatch.purchase_price_pack) || 0;
                  const deficitCostUnit = unitsPerPack > 0 ? deficitCostPack / unitsPerPack : deficitCostPack;
                  const deficitLineCost = isPack ? deficitCostPack * deficitQty : deficitCostUnit * deficitQty;

                  subtotal += deficitLineTotal;

                  lineItemsToInsert.push({
                    id: crypto.randomUUID(),
                    saleId,
                    inventoryItemId: item.inventoryItemId,
                    inventoryBatchId: latestBatch.id,
                    unitType: item.unitType,
                    quantity: deficitQty,
                    unitPrice: deficitUnitPrice,
                    totalPrice: deficitLineTotal,
                    costPricePack: deficitCostPack,
                    costPriceUnit: deficitCostUnit,
                    totalCost: deficitLineCost,
                  });
                } else {
                  // Auto deficit batch placeholder
                  const placeholderBatchId = crypto.randomUUID();
                  await tx.$executeRawUnsafe(
                    `INSERT INTO "${schemaName}".inventory_batches 
                     (id, inventory_item_id, batch_number, purchase_price_pack, selling_price_pack, selling_price_unit, quantity_units_remaining, expiry_date, is_recalled, created_at) 
                     VALUES ($1::uuid, $2::uuid, 'AUTO-DEFICIT', 0, $3, $4, $5, (CURRENT_DATE + interval '2 years')::date, FALSE, NOW())`,
                    placeholderBatchId,
                    item.inventoryItemId,
                    defaultPackPrice,
                    defaultUnitPrice,
                    -unitsToDeduct,
                  );

                  const lineTotal = (isPack ? defaultPackPrice : defaultUnitPrice) * item.quantity;
                  subtotal += lineTotal;

                  lineItemsToInsert.push({
                    id: crypto.randomUUID(),
                    saleId,
                    inventoryItemId: item.inventoryItemId,
                    inventoryBatchId: placeholderBatchId,
                    unitType: item.unitType,
                    quantity: item.quantity,
                    unitPrice: isPack ? defaultPackPrice : defaultUnitPrice,
                    totalPrice: lineTotal,
                    costPricePack: 0,
                    costPriceUnit: 0,
                    totalCost: 0,
                  });
                }
              }
            }

            const discountAmount = Math.min(Number(dto.discountAmount || 0), subtotal);
            const totalAmount = Math.max(0, subtotal - discountAmount);

            // D. Insert sales record using parameterized query with offline_id
            await tx.$executeRawUnsafe(
              `INSERT INTO "${schemaName}".sales 
               (id, invoice_number, user_id, subtotal, discount_amount, total_amount, offline_id, created_at) 
               VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, NOW())`,
              saleId,
              invoiceNumber,
              userId || null,
              subtotal,
              discountAmount,
              totalAmount,
              dto.offlineId ? dto.offlineId.trim() : null,
            );

            // E. Insert all sale_items with snapshotted cost values
            for (const line of lineItemsToInsert) {
              await tx.$executeRawUnsafe(
                `INSERT INTO "${schemaName}".sale_items 
                 (id, sale_id, inventory_item_id, inventory_batch_id, unit_type, quantity, unit_price, total_price, cost_price_pack, cost_price_unit, total_cost) 
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11)`,
                line.id,
                line.saleId,
                line.inventoryItemId,
                line.inventoryBatchId,
                line.unitType,
                line.quantity,
                line.unitPrice,
                line.totalPrice,
                line.costPricePack || 0,
                line.costPriceUnit || 0,
                line.totalCost || 0,
              );
            }

            return {
              id: saleId,
              invoiceNumber,
              subtotal,
              discountAmount,
              totalAmount,
              createdAt: new Date().toISOString(),
              items: lineItemsToInsert,
              affectedMedicineIds,
            };
          },
          {
            isolationLevel: 'ReadCommitted' as any,
            timeout: 15000,
          },
        );
        break; // Success, exit retry loop
      } catch (err: any) {
        // Catch concurrent offline_id collision
        if (dto.offlineId && (err.message?.includes('sales_offline_id') || err.message?.includes('offline_id'))) {
          this.logger.warn(`Concurrent offline_id conflict caught. Fetching existing sale.`);
          const existing = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, invoice_number as "invoiceNumber", subtotal, discount_amount as "discountAmount", 
                    total_amount as "totalAmount", created_at as "createdAt", offline_id as "offlineId"
             FROM "${schemaName}".sales 
             WHERE offline_id = $1::text LIMIT 1`,
            dto.offlineId.trim(),
          );
          if (existing && existing.length > 0) {
            const sale = existing[0];
            const items = await this.prisma.$queryRawUnsafe<any[]>(
              `SELECT id, sale_id as "saleId", inventory_item_id as "inventoryItemId", 
                      inventory_batch_id as "inventoryBatchId", unit_type as "unitType", 
                      quantity, unit_price as "unitPrice", total_price as "totalPrice"
               FROM "${schemaName}".sale_items 
               WHERE sale_id = $1::uuid`,
              sale.id,
            );
            return {
              ...sale,
              items,
              isIdempotentReplay: true,
            };
          }
        }

        // Retry on invoice_number collision
        if ((err.message?.includes('invoice_number') || err.message?.includes('sales_invoice_number_key')) && attempt < 3) {
          this.logger.warn(`Invoice number collision on attempt ${attempt}. Regenerating number and retrying.`);
          invoiceNumber = this.generateInvoiceNumber();
          saleId = crypto.randomUUID();
          continue;
        }

        throw err;
      }
    }

    if (!transactionResult) {
      throw new BadRequestException('فشلت عملية إنشاء الفاتورة بعد عدة محاولات');
    }

    // 4. Emit sync and completion events after successful commit
    this.eventEmitter.emit('inventory.synced', {
      tenantId,
      schemaName,
      medicineIds: transactionResult.affectedMedicineIds,
    });

    const completedSaleRecord = {
      id: transactionResult.id,
      invoiceNumber: transactionResult.invoiceNumber,
      subtotal: transactionResult.subtotal,
      discountAmount: transactionResult.discountAmount,
      totalAmount: transactionResult.totalAmount,
      createdAt: transactionResult.createdAt,
      items: transactionResult.items,
    };

    this.eventEmitter.emit('sale.completed', {
      tenantId,
      schemaName,
      sale: completedSaleRecord,
    });

    this.logger.log(`Atomic locked checkout completed safely. Invoice: ${invoiceNumber}`);

    return completedSaleRecord;
  }

  /**
   * Bulk Sync Offline Sales created during internet outage with idempotency
   */
  async syncOfflineSales(dto: SyncOfflineSalesDto) {
    const results: { offlineId: string; success: boolean; sale?: any; error?: string }[] = [];

    for (const offlineSale of dto.sales) {
      try {
        const checkoutDto: CheckoutDto = {
          items: offlineSale.items,
          discountAmount: Number(offlineSale.discountAmount || 0),
          offlineId: offlineSale.offlineId,
        };
        const sale = await this.checkout(checkoutDto);
        results.push({
          offlineId: offlineSale.offlineId,
          success: true,
          sale,
        });
      } catch (err: any) {
        results.push({
          offlineId: offlineSale.offlineId,
          success: false,
          error: err.message || 'فشلت المزامنة',
        });
      }
    }

    return {
      syncedCount: results.filter((r) => r.success).length,
      totalCount: dto.sales.length,
      results,
    };
  }

  /**
   * Process Quick Return (Refund item back to stock or mark as damaged)
   * Implements Reverse-FEFO & exact batch allocation to prevent inventory corruption.
   */
  async processReturn(dto: CreateReturnDto) {
    const schemaName = this.tenantContext.getSchemaName();
    const tenantId = this.tenantContext.getTenantId();
    const ctx = this.tenantContext.getContext();
    const userId = ctx?.userId;

    await this.ensureReturnColumnsExist(schemaName);

    // 1. Fetch inventory item with medicine details
    const itemRows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT ii.id, ii.medicine_id, ii.units_per_pack, ii.selling_price_pack, ii.selling_price_unit,
              COALESCE(ii.custom_name, m.trade_name, 'دواء') as "tradeName",
              m.scientific_name as "scientificName"
       FROM "${schemaName}".inventory_items ii
       LEFT JOIN public.medicines m ON ii.medicine_id = m.id
       WHERE ii.id = $1::uuid`,
      dto.inventoryItemId,
    );

    if (itemRows.length === 0) {
      throw new NotFoundException('المادة غير موجودة في المخزون');
    }

    const invItem = itemRows[0];
    const isPack = dto.unitType === UnitTypeEnum.PACK;
    const unitsPerPack = Number(invItem.units_per_pack) || 1;
    const unitsToReturn = isPack ? dto.quantity * unitsPerPack : dto.quantity;

    const allocations: ReturnAllocation[] = [];
    let calculatedRefundTotal = 0;

    // SCENARIO 1: Returning against an existing Invoice (saleId provided)
    if (dto.saleId) {
      // 1. Fetch all sale items for this invoice and medicine, ordered by expiry date DESC (Reverse FEFO)
      const saleItems: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT si.id, si.inventory_batch_id, si.unit_type, si.quantity, si.unit_price,
                si.cost_price_pack, si.cost_price_unit, si.total_cost,
                COALESCE(b.purchase_price_pack, 0) as batch_purchase_price_pack,
                COALESCE(b.batch_number, 'BATCH') as batch_number, b.expiry_date
         FROM "${schemaName}".sale_items si
         LEFT JOIN "${schemaName}".inventory_batches b ON si.inventory_batch_id = b.id
         WHERE si.sale_id = $1::uuid AND si.inventory_item_id = $2::uuid
         ORDER BY b.expiry_date DESC NULLS LAST, si.id DESC`,
        dto.saleId,
        dto.inventoryItemId,
      );

      if (saleItems.length === 0) {
        throw new NotFoundException('المادة المحددة غير مسجلة في الفاتورة الأصلية');
      }

      // 2. Fetch all prior returns on this invoice for this item
      const priorReturns: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT inventory_batch_id, unit_type, quantity 
         FROM "${schemaName}".returns 
         WHERE sale_id = $1::uuid AND inventory_item_id = $2::uuid`,
        dto.saleId,
        dto.inventoryItemId,
      );

      const previouslyReturnedUnitsByBatch = new Map<string, number>();
      let unassignedReturnedUnits = 0;

      for (const pr of priorReturns) {
        const prUnits = pr.unit_type === UnitTypeEnum.PACK
          ? Number(pr.quantity) * unitsPerPack
          : Number(pr.quantity);

        if (pr.inventory_batch_id) {
          const curr = previouslyReturnedUnitsByBatch.get(pr.inventory_batch_id) || 0;
          previouslyReturnedUnitsByBatch.set(pr.inventory_batch_id, curr + prUnits);
        } else {
          unassignedReturnedUnits += prUnits;
        }
      }

      // 3. Map batches with their remaining returnable units and snapshotted cost values
      const soldBatches = saleItems.map((si) => {
        const soldUnits = si.unit_type === UnitTypeEnum.PACK
          ? Number(si.quantity) * unitsPerPack
          : Number(si.quantity);
        const batchId = si.inventory_batch_id;
        const alreadyReturned = previouslyReturnedUnitsByBatch.get(batchId) || 0;
        const costPricePack = Number(si.cost_price_pack) || Number(si.batch_purchase_price_pack) || 0;
        const costPriceUnit = Number(si.cost_price_unit) || (unitsPerPack > 0 ? costPricePack / unitsPerPack : costPricePack);
        return {
          batchId,
          batchNumber: si.batch_number,
          soldUnits,
          alreadyReturned,
          unitPrice: Number(si.unit_price),
          costPricePack,
          costPriceUnit,
          isPackSold: si.unit_type === UnitTypeEnum.PACK,
        };
      });

      // Distribute any legacy unassigned returns against sold batches
      if (unassignedReturnedUnits > 0) {
        for (const sb of soldBatches) {
          const remaining = sb.soldUnits - sb.alreadyReturned;
          if (remaining > 0) {
            const absorb = Math.min(remaining, unassignedReturnedUnits);
            sb.alreadyReturned += absorb;
            unassignedReturnedUnits -= absorb;
            if (unassignedReturnedUnits <= 0) break;
          }
        }
      }

      const totalReturnableUnits = soldBatches.reduce(
        (acc, b) => acc + Math.max(0, b.soldUnits - b.alreadyReturned),
        0,
      );

      if (unitsToReturn > totalReturnableUnits) {
        const returnablePacks = Math.floor(totalReturnableUnits / unitsPerPack);
        const returnableRemainder = totalReturnableUnits % unitsPerPack;
        const availMsg = isPack
          ? `${returnablePacks} علبة${returnableRemainder > 0 ? ` و ${returnableRemainder} شريط` : ''}`
          : `${totalReturnableUnits} شريط`;
        throw new BadRequestException(
          `الكمية المراد إرجاعها تتجاوز الكمية المتبقية القابلة للإرجاع في الفاتورة الأصلية. الحد الأقصى المتاح للإرجاع: ${availMsg}`,
        );
      }

      // 4. If caller explicitly specified a specific batch
      if (dto.inventoryBatchId) {
        const targetSoldBatch = soldBatches.find((b) => b.batchId === dto.inventoryBatchId);
        if (!targetSoldBatch) {
          throw new BadRequestException('الوجبة المحددة لم يتم بيعها ضمن هذه الفاتورة الأصلية');
        }
        const availableInThisBatch = targetSoldBatch.soldUnits - targetSoldBatch.alreadyReturned;
        if (unitsToReturn > availableInThisBatch) {
          const batchAvailPacks = Math.floor(availableInThisBatch / unitsPerPack);
          const batchAvailRem = availableInThisBatch % unitsPerPack;
          const msg = isPack
            ? `${batchAvailPacks} علبة${batchAvailRem > 0 ? ` و ${batchAvailRem} شريط` : ''}`
            : `${availableInThisBatch} شريط`;
          throw new BadRequestException(
            `الكمية المراد إرجاعها من الوجبة (${targetSoldBatch.batchNumber}) تتجاوز الكمية المتبقية منها في الفاتورة (${msg})`,
          );
        }

        allocations.push({
          batchId: targetSoldBatch.batchId,
          batchNumber: targetSoldBatch.batchNumber,
          units: unitsToReturn,
          unitPrice: targetSoldBatch.unitPrice,
          costPricePack: targetSoldBatch.costPricePack,
          costPriceUnit: targetSoldBatch.costPriceUnit,
        });

        const unitCost = targetSoldBatch.isPackSold
          ? targetSoldBatch.unitPrice / unitsPerPack
          : targetSoldBatch.unitPrice;
        calculatedRefundTotal = Math.round(unitCost * unitsToReturn);
      } else {
        // 5. Automatic distribution via Reverse FEFO
        // Fresher batches (sold last under FEFO) get returned first, each up to its actual sold limit
        let remainingToReturn = unitsToReturn;
        for (const sb of soldBatches) {
          if (remainingToReturn <= 0) break;
          const available = sb.soldUnits - sb.alreadyReturned;
          if (available > 0) {
            const allocateUnits = Math.min(remainingToReturn, available);
            allocations.push({
              batchId: sb.batchId,
              batchNumber: sb.batchNumber,
              units: allocateUnits,
              unitPrice: sb.unitPrice,
              costPricePack: sb.costPricePack,
              costPriceUnit: sb.costPriceUnit,
            });

            const unitCost = sb.isPackSold
              ? sb.unitPrice / unitsPerPack
              : sb.unitPrice;
            calculatedRefundTotal += Math.round(unitCost * allocateUnits);
            remainingToReturn -= allocateUnits;
          }
        }
      }
    } else {
      // SCENARIO 2: Quick Return without invoice (saleId omitted)
      const defaultPrice = isPack
        ? Number(invItem.selling_price_pack) || 0
        : Number(invItem.selling_price_unit) || 0;
      calculatedRefundTotal = Math.round(defaultPrice * dto.quantity);

      if (dto.inventoryBatchId) {
        // Pharmacist selected an explicit batch
        const batchRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT id, batch_number, expiry_date, is_recalled, purchase_price_pack 
           FROM "${schemaName}".inventory_batches 
           WHERE id = $1::uuid AND inventory_item_id = $2::uuid`,
          dto.inventoryBatchId,
          dto.inventoryItemId,
        );
        if (batchRows.length === 0) {
          throw new NotFoundException('تشغيلة الوجبة المحددة غير موجودة لهذه المادة');
        }
        const bCostPack = Number(batchRows[0].purchase_price_pack) || 0;
        const bCostUnit = unitsPerPack > 0 ? bCostPack / unitsPerPack : bCostPack;
        allocations.push({
          batchId: batchRows[0].id,
          batchNumber: batchRows[0].batch_number || 'UNKNOWN',
          units: unitsToReturn,
          unitPrice: defaultPrice,
          costPricePack: bCostPack,
          costPriceUnit: bCostUnit,
        });
      } else {
        // Pick best active non-recalled batch with latest expiry
        const candidateBatches: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT id, batch_number, expiry_date, quantity_units_remaining, purchase_price_pack 
           FROM "${schemaName}".inventory_batches 
           WHERE inventory_item_id = $1::uuid 
             AND expiry_date >= CURRENT_DATE 
             AND (is_recalled IS FALSE OR is_recalled IS NULL)
           ORDER BY expiry_date DESC, created_at DESC 
           LIMIT 1`,
          dto.inventoryItemId,
        );

        let targetBatch = candidateBatches[0];
        if (!targetBatch) {
          const fallbackBatches: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id, batch_number, expiry_date, quantity_units_remaining, purchase_price_pack 
             FROM "${schemaName}".inventory_batches 
             WHERE inventory_item_id = $1::uuid 
             ORDER BY created_at DESC 
             LIMIT 1`,
            dto.inventoryItemId,
          );
          targetBatch = fallbackBatches[0];
        }

        if (!targetBatch) {
          throw new NotFoundException('لا توجد أي تشغيلة مسجلة لهذه المادة في المخزون');
        }

        const bCostPack = Number(targetBatch.purchase_price_pack) || 0;
        const bCostUnit = unitsPerPack > 0 ? bCostPack / unitsPerPack : bCostPack;
        allocations.push({
          batchId: targetBatch.id,
          batchNumber: targetBatch.batch_number || 'UNKNOWN',
          units: unitsToReturn,
          unitPrice: defaultPrice,
          costPricePack: bCostPack,
          costPriceUnit: bCostUnit,
        });
      }
    }

    // Strict Refund Amount Validation:
    let refundAmount = calculatedRefundTotal;
    if (dto.refundAmount !== undefined && dto.refundAmount !== null) {
      const requestedRefund = Number(dto.refundAmount);
      if (isNaN(requestedRefund) || requestedRefund < 0) {
        throw new BadRequestException('مبلغ الاسترجاع غير صالح');
      }
      if (requestedRefund > calculatedRefundTotal) {
        throw new BadRequestException(
          `مبلغ الاسترجاع المطلوب (${requestedRefund.toLocaleString()} د.ع) يتجاوز الحد الأقصى المسموح به (${calculatedRefundTotal.toLocaleString()} د.ع) بناءً على سعر البيع الفعلي للوجبات المرجعة`,
        );
      }
      refundAmount = requestedRefund;
    }

    const returnId = crypto.randomUUID();
    const condition = dto.itemCondition || ItemConditionEnum.RESALEABLE;
    const paymentMethod = dto.paymentMethod || 'CASH';

    // Get Cashier Name
    let cashierName = 'الكاشير';
    if (userId) {
      const uRows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT name FROM "${schemaName}".users WHERE id = $1::uuid LIMIT 1`,
        userId,
      );
      if (uRows.length > 0 && uRows[0].name) {
        cashierName = uRows[0].name;
      }
    }

    // Execute Stock Increment & Return Record Insertion inside an ACID Transaction with Row Locks
    await this.prisma.$transaction(async (tx) => {
      // 1. Deterministically sort allocation batch IDs to prevent deadlocks
      const sortedAllocations = [...allocations].sort((a, b) => a.batchId.localeCompare(b.batchId));

      // 2. Lock & update each allocated batch (if RESALEABLE)
      if (condition === ItemConditionEnum.RESALEABLE) {
        for (const alloc of sortedAllocations) {
          // Acquire exclusive row lock before incrementing
          await tx.$queryRawUnsafe(
            `SELECT id FROM "${schemaName}".inventory_batches WHERE id = $1::uuid FOR UPDATE`,
            alloc.batchId,
          );

          await tx.$executeRawUnsafe(
            `UPDATE "${schemaName}".inventory_batches 
             SET quantity_units_remaining = quantity_units_remaining + $1 
             WHERE id = $2::uuid`,
            alloc.units,
            alloc.batchId,
          );
        }
      }

      // 3. Insert return records with exact batch foreign key
      for (let i = 0; i < allocations.length; i++) {
        const alloc = allocations[i];
        const lineReturnId = i === 0 ? returnId : crypto.randomUUID();
        const allocRefund = allocations.length === 1
          ? refundAmount
          : Math.round((alloc.units / unitsToReturn) * refundAmount);
        const allocQty = isPack ? alloc.units / unitsPerPack : alloc.units;
        const allocUnitCost = isPack ? (alloc.costPricePack || 0) : (alloc.costPriceUnit || 0);
        const allocTotalCost = Math.round(allocUnitCost * allocQty);

        await tx.$executeRawUnsafe(
          `INSERT INTO "${schemaName}".returns 
           (id, sale_id, inventory_item_id, inventory_batch_id, user_id, unit_type, quantity, refund_amount, unit_cost, total_cost, reason, item_condition, payment_method, user_name, notes, trade_name, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
          lineReturnId,
          dto.saleId || null,
          dto.inventoryItemId,
          alloc.batchId,
          userId || null,
          dto.unitType,
          allocQty,
          allocRefund,
          allocUnitCost,
          allocTotalCost,
          dto.reason || 'إرجاع سريع',
          condition,
          paymentMethod,
          cashierName,
          dto.notes || null,
          invItem.tradeName,
        );
      }
    });

    if (condition === ItemConditionEnum.RESALEABLE) {
      this.eventEmitter.emit('inventory.synced', {
        tenantId,
        schemaName,
        medicineIds: [invItem.medicine_id],
      });
    } else {
      this.logger.log(
        `Returned item ${invItem.tradeName} marked as DAMAGED. Units (${unitsToReturn}) quarantined and excluded from active sale stock.`,
      );
    }

    const batchSummary = allocations
      .map((a) => `${a.batchNumber} (${isPack ? Math.round((a.units / unitsPerPack) * 100) / 100 : a.units} ${isPack ? 'علبة' : 'شريط'})`)
      .join('، ');

    return {
      success: true,
      returnId,
      refundAmount,
      tradeName: invItem.tradeName,
      scientificName: invItem.scientificName,
      quantity: dto.quantity,
      unitType: dto.unitType,
      itemCondition: condition,
      paymentMethod,
      reason: dto.reason || 'إرجاع سريع',
      createdAt: new Date().toISOString(),
      cashierName,
      allocations,
      message: condition === ItemConditionEnum.RESALEABLE
        ? `تم إرجاع (${dto.quantity} ${isPack ? 'علبة' : 'شريط'}) من (${invItem.tradeName}) بنجاح واسترداد (${refundAmount.toLocaleString()} د.ع) إلى الوجبات: [${batchSummary}].`
        : `تم توثيق إرجاع (${dto.quantity} ${isPack ? 'علبة' : 'شريط'}) من (${invItem.tradeName}) كـ (تالف/غير صالح للبيع) واسترداد (${refundAmount.toLocaleString()} د.ع) دون إعادته للرفوف.`,
    };
  }

  /**
   * Get Recent Returns List for POS
   */
  async getRecentReturns(limit: number = 20) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensureReturnColumnsExist(schemaName);

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const sql = `
      SELECT 
        r.id,
        r.sale_id as "saleId",
        r.inventory_item_id as "inventoryItemId",
        r.inventory_batch_id as "inventoryBatchId",
        COALESCE(b.batch_number, 'BATCH') as "batchNumber",
        COALESCE(r.trade_name, m.trade_name, 'دواء') as "tradeName",
        r.unit_type as "unitType",
        r.quantity,
        r.refund_amount as "refundAmount",
        COALESCE(r.item_condition, 'RESALEABLE') as "itemCondition",
        COALESCE(r.payment_method, 'CASH') as "paymentMethod",
        r.reason,
        r.notes,
        r.created_at as "createdAt",
        COALESCE(r.user_name, u.name, 'الكاشير') as "cashierName"
      FROM "${schemaName}".returns r
      LEFT JOIN "${schemaName}".inventory_items ii ON r.inventory_item_id = ii.id
      LEFT JOIN "${schemaName}".inventory_batches b ON r.inventory_batch_id = b.id
      LEFT JOIN public.medicines m ON ii.medicine_id = m.id
      LEFT JOIN "${schemaName}".users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
      LIMIT $1;
    `;

    const list: any[] = await this.prisma.$queryRawUnsafe(sql, safeLimit);
    return list;
  }

  /**
   * Get single Sale / Invoice details with line items
   */
  async getSaleById(saleId: string) {
    const schemaName = this.tenantContext.getSchemaName();

    const sales: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT 
         s.id,
         s.invoice_number as "invoiceNumber",
         s.subtotal,
         s.discount_amount as "discountAmount",
         s.total_amount as "totalAmount",
         s.created_at as "createdAt",
         u.name as "cashierName"
       FROM "${schemaName}".sales s
       LEFT JOIN "${schemaName}".users u ON s.user_id = u.id
       WHERE s.id = $1::uuid`,
      saleId,
    );

    if (sales.length === 0) {
      throw new NotFoundException('الفاتورة غير موجودة');
    }

    const sale = sales[0];

    const items: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT 
         si.id,
         si.unit_type as "unitType",
         si.quantity,
         si.unit_price as "unitPrice",
         si.total_price as "totalPrice",
         b.batch_number as "batchNumber",
         m.trade_name as "tradeName",
         m.scientific_name as "scientificName",
         m.dosage_form as "dosageForm"
       FROM "${schemaName}".sale_items si
       JOIN "${schemaName}".inventory_items i ON si.inventory_item_id = i.id
       JOIN public.medicines m ON i.medicine_id = m.id
       LEFT JOIN "${schemaName}".inventory_batches b ON si.inventory_batch_id = b.id
       WHERE si.sale_id = $1::uuid`,
      saleId,
    );

    return {
      ...sale,
      items,
    };
  }

  /**
   * Get Cashier Daily Shift Summary (Sales, Refunds, Cash in Drawer)
   */
  async getDailySummary() {
    const schemaName = this.tenantContext.getSchemaName();

    // Today's Sales
    const salesSummary: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT 
         COUNT(id)::int as "totalInvoices",
         COALESCE(SUM(subtotal), 0)::numeric as "totalSubtotal",
         COALESCE(SUM(discount_amount), 0)::numeric as "totalDiscounts",
         COALESCE(SUM(total_amount), 0)::numeric as "totalSalesRevenue"
       FROM "${schemaName}".sales
       WHERE created_at >= CURRENT_DATE`,
    );

    // Today's Returns
    const returnsSummary: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT 
         COUNT(id)::int as "totalReturnsCount",
         COALESCE(SUM(refund_amount), 0)::numeric as "totalRefunds"
       FROM "${schemaName}".returns
       WHERE created_at >= CURRENT_DATE`,
    );

    const s = salesSummary[0];
    const r = returnsSummary[0];

    const netCashInDrawer = Number(s.totalSalesRevenue) - Number(r.totalRefunds);

    return {
      date: new Date().toISOString().slice(0, 10),
      totalInvoices: s.totalInvoices,
      totalSalesRevenue: Number(s.totalSalesRevenue),
      totalDiscounts: Number(s.totalDiscounts),
      totalReturnsCount: r.totalReturnsCount,
      totalRefunds: Number(r.totalRefunds),
      netCashInDrawer,
    };
  }

  /**
   * Get Sales History with pagination and search
   */
  async getSalesHistory(query?: { limit?: number; search?: string }) {
    const schemaName = this.tenantContext.getSchemaName();
    const limit = Math.min(Number(query?.limit || 50), 100);

    let searchFilter = '';
    const params: any[] = [limit];

    if (query?.search && query.search.trim().length > 0) {
      params.push(`%${query.search.trim()}%`);
      searchFilter = `AND (s.invoice_number ILIKE $2 OR u.name ILIKE $2)`;
    }

    const sql = `
      SELECT 
        s.id,
        s.invoice_number as "invoiceNumber",
        s.subtotal,
        s.discount_amount as "discountAmount",
        s.total_amount as "totalAmount",
        s.created_at as "createdAt",
        u.name as "cashierName",
        (SELECT COUNT(id)::int FROM "${schemaName}".sale_items WHERE sale_id = s.id) as "itemsCount"
      FROM "${schemaName}".sales s
      LEFT JOIN "${schemaName}".users u ON s.user_id = u.id
      WHERE 1=1 ${searchFilter}
      ORDER BY s.created_at DESC
      LIMIT $1;
    `;

    const sales: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
    return sales;
  }

  /**
   * Close Shift Handover with cash reconciliation
   */
  async closeShiftHandover(user: any, dto: { actualCash: number; openingCash?: number; notes?: string }) {
    const schemaName = this.tenantContext.getSchemaName();

    // Calculate today's sales and returns for expected cash
    const summary = await this.getDailySummary();
    const openingCash = Number(dto.openingCash || 0);
    const expectedCash = openingCash + summary.netCashInDrawer;
    const actualCash = Number(dto.actualCash || 0);
    const cashDifference = actualCash - expectedCash;

    const result: any[] = await this.prisma.$queryRawUnsafe(`
      INSERT INTO "${schemaName}".shift_logs (
        user_id, user_name, opening_cash, expected_cash, actual_cash, cash_difference,
        total_sales_count, total_sales_amount, notes, status, closed_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, 'CLOSED', CURRENT_TIMESTAMP
      ) RETURNING id, opened_at as "openedAt", closed_at as "closedAt";
    `,
      user.id,
      user.name || 'الكاشير',
      openingCash,
      expectedCash,
      actualCash,
      cashDifference,
      summary.totalInvoices,
      summary.totalSalesRevenue,
      dto.notes || null
    );

    return {
      message: 'تم إغلاق الوردية وتوثيق المطابقة النقدية بنجاح',
      shiftId: result[0]?.id,
      openedAt: result[0]?.openedAt,
      closedAt: result[0]?.closedAt,
      openingCash,
      expectedCash,
      actualCash,
      cashDifference,
      totalSalesCount: summary.totalInvoices,
      totalSalesAmount: summary.totalSalesRevenue,
      netCashInDrawer: summary.netCashInDrawer,
    };
  }

  /**
   * Get shift history logs
   */
  async getShiftHistory(limit: number = 30) {
    const schemaName = this.tenantContext.getSchemaName();
    const sql = `
      SELECT 
        id,
        user_id as "userId",
        user_name as "userName",
        opened_at as "openedAt",
        closed_at as "closedAt",
        opening_cash as "openingCash",
        expected_cash as "expectedCash",
        actual_cash as "actualCash",
        cash_difference as "cashDifference",
        total_sales_count as "totalSalesCount",
        total_sales_amount as "totalSalesAmount",
        notes,
        status
      FROM "${schemaName}".shift_logs
      ORDER BY closed_at DESC, opened_at DESC
      LIMIT $1;
    `;
    try {
      return await this.prisma.$queryRawUnsafe(sql, limit);
    } catch {
      return [];
    }
  }
}
