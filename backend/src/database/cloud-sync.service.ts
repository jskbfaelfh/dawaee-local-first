import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { LocalDbService } from './local-db.service';
import { validateAndSanitizeSchemaName } from '../common/utils/security.util';
import * as crypto from 'crypto';

@Injectable()
export class CloudSyncService implements OnModuleInit {
  private readonly logger = new Logger(CloudSyncService.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly localDb: LocalDbService,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing Background Cloud Sync Service...');
    setInterval(() => this.processSyncQueue(), 15000); // Sync every 15s in background
  }

  /**
   * Process pending items in local SQLite sync queue
   */
  async processSyncQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessing) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    this.isProcessing = true;

    let succeeded = 0;
    let failed = 0;

    try {
      const items = this.localDb.query(
        'SELECT * FROM sync_queue WHERE synced = 0 ORDER BY id ASC LIMIT 20',
      );

      if (!items || items.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0 };
      }

      for (const item of items) {
        try {
          const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
          await this.syncItem(item.table_name, item.action, payload);

          // Mark successful sync
          this.localDb.execute(
            'UPDATE sync_queue SET synced = 1, last_error = NULL WHERE id = ?',
            [item.id],
          );
          succeeded++;
        } catch (err: any) {
          failed++;
          const nextRetry = (Number(item.retry_count) || 0) + 1;
          const errorMsg = (err.message || 'Unknown sync error').slice(0, 500);

          if (nextRetry >= 5) {
            this.logger.error(`Sync item ${item.id} (${item.table_name}) failed permanently after 5 retries: ${errorMsg}`);
            this.localDb.execute(
              'UPDATE sync_queue SET synced = -1, retry_count = ?, last_error = ? WHERE id = ?',
              [nextRetry, errorMsg, item.id],
            );
          } else {
            this.logger.warn(`Sync item ${item.id} (${item.table_name}) failed on attempt ${nextRetry}: ${errorMsg}`);
            this.localDb.execute(
              'UPDATE sync_queue SET retry_count = ?, last_error = ? WHERE id = ?',
              [nextRetry, errorMsg, item.id],
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error during cloud sync queue processing: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }

    return { processed: succeeded + failed, succeeded, failed };
  }

  /**
   * Router to handle specific entity sync operations
   */
  private async syncItem(tableName: string, action: string, payload: any): Promise<void> {
    switch (tableName) {
      case 'medicines':
        await this.syncMedicine(payload);
        break;

      case 'sales':
      case 'pos':
        await this.syncSale(payload);
        break;

      case 'inventory_batches':
      case 'inventory':
        await this.syncInventoryBatch(payload);
        break;

      case 'expenses':
        await this.syncExpense(payload);
        break;

      case 'purchases':
      case 'purchase_invoices':
        await this.syncPurchase(payload);
        break;

      default:
        throw new Error(`نوع الكيان غير مدعوم للمزامنة: ${tableName}`);
    }
  }

  /**
   * Sync Master Medicine record
   */
  private async syncMedicine(payload: any) {
    if (!payload.id || !payload.trade_name) {
      throw new Error('Invalid medicine payload: missing id or trade_name');
    }
    await this.prisma.medicine.upsert({
      where: { id: payload.id },
      create: {
        id: payload.id,
        tradeName: payload.trade_name || payload.tradeName,
        scientificName: payload.scientific_name || payload.scientificName || null,
        dosageForm: payload.dosage_form || payload.dosageForm || null,
        strength: payload.strength || null,
        manufacturer: payload.manufacturer || null,
        barcode: payload.barcode || null,
        defaultUnitsPerPack: payload.default_units_per_pack || payload.defaultUnitsPerPack || 1,
        isVerified: Boolean(payload.is_verified || payload.isVerified),
      },
      update: {
        tradeName: payload.trade_name || payload.tradeName,
        scientificName: payload.scientific_name || payload.scientificName || null,
        dosageForm: payload.dosage_form || payload.dosageForm || null,
        strength: payload.strength || null,
        manufacturer: payload.manufacturer || null,
        barcode: payload.barcode || null,
        defaultUnitsPerPack: payload.default_units_per_pack || payload.defaultUnitsPerPack || 1,
        isVerified: Boolean(payload.is_verified || payload.isVerified),
      },
    });
  }

  /**
   * Sync Offline Sale into Tenant Schema with Idempotency
   */
  private async syncSale(payload: any) {
    const rawSchema = payload.schemaName || payload.schema;
    if (!rawSchema) throw new Error('Sale payload missing schemaName');
    const schema = validateAndSanitizeSchemaName(rawSchema);

    const sale = payload.sale || payload;
    const offlineId = sale.offlineId || sale.offline_id;

    // Idempotency check: If offline_id already exists in tenant schema, skip
    if (offlineId) {
      const existing = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM "${schema}".sales WHERE offline_id = $1::text LIMIT 1`,
        offlineId,
      );
      if (existing && existing.length > 0) {
        this.logger.log(`Sale with offlineId ${offlineId} already exists in ${schema}. Sync skipped.`);
        return;
      }
    }

    const saleId = sale.id || crypto.randomUUID();
    const invoiceNumber = sale.invoiceNumber || sale.invoice_number || `INV-OFFLINE-${Date.now()}`;
    const subtotal = Number(sale.subtotal || 0);
    const discountAmount = Number(sale.discountAmount || sale.discount_amount || 0);
    const totalAmount = Number(sale.totalAmount || sale.total_amount || (subtotal - discountAmount));
    const userId = sale.userId || sale.user_id || null;

    await this.prisma.$transaction(async (tx) => {
      // 1. Insert sale record
      await tx.$executeRawUnsafe(
        `INSERT INTO "${schema}".sales 
         (id, invoice_number, user_id, subtotal, discount_amount, total_amount, offline_id, created_at) 
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::timestamp)
         ON CONFLICT (id) DO NOTHING`,
        saleId,
        invoiceNumber,
        userId,
        subtotal,
        discountAmount,
        totalAmount,
        offlineId || null,
        sale.createdAt || sale.created_at || new Date(),
      );

      // 2. Insert items and decrement remaining batch quantities if provided
      if (Array.isArray(sale.items)) {
        for (const item of sale.items) {
          const itemId = item.id || crypto.randomUUID();
          await tx.$executeRawUnsafe(
            `INSERT INTO "${schema}".sale_items 
             (id, sale_id, inventory_item_id, inventory_batch_id, unit_type, quantity, unit_price, total_price) 
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING`,
            itemId,
            saleId,
            item.inventoryItemId || item.inventory_item_id,
            item.inventoryBatchId || item.inventory_batch_id || null,
            item.unitType || item.unit_type || 'UNIT',
            Number(item.quantity || 1),
            Number(item.unitPrice || item.unit_price || 0),
            Number(item.totalPrice || item.total_price || 0),
          );

          if (item.inventoryBatchId || item.inventory_batch_id) {
            const batchId = item.inventoryBatchId || item.inventory_batch_id;
            const unitsToDeduct = Number(item.quantity || 1);
            await tx.$executeRawUnsafe(
              `UPDATE "${schema}".inventory_batches 
               SET quantity_units_remaining = quantity_units_remaining - $1 
               WHERE id = $2::uuid`,
              unitsToDeduct,
              batchId,
            );
          }
        }
      }
    });
  }

  /**
   * Sync Inventory Batch adjustment
   */
  private async syncInventoryBatch(payload: any) {
    const rawSchema = payload.schemaName || payload.schema;
    if (!rawSchema) throw new Error('Inventory batch payload missing schemaName');
    const schema = validateAndSanitizeSchemaName(rawSchema);

    const batch = payload.batch || payload;
    const batchId = batch.id || crypto.randomUUID();

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".inventory_batches 
       (id, inventory_item_id, batch_number, purchase_price_pack, selling_price_pack, selling_price_unit, quantity_units_remaining, expiry_date, created_at) 
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date, NOW())
       ON CONFLICT (id) DO UPDATE SET 
         quantity_units_remaining = EXCLUDED.quantity_units_remaining,
         selling_price_pack = COALESCE(EXCLUDED.selling_price_pack, "${schema}".inventory_batches.selling_price_pack),
         selling_price_unit = COALESCE(EXCLUDED.selling_price_unit, "${schema}".inventory_batches.selling_price_unit)`,
      batchId,
      batch.inventoryItemId || batch.inventory_item_id,
      batch.batchNumber || batch.batch_number || null,
      Number(batch.purchasePricePack || batch.purchase_price_pack || 0),
      batch.sellingPricePack != null ? Number(batch.sellingPricePack) : null,
      batch.sellingPriceUnit != null ? Number(batch.sellingPriceUnit) : null,
      Number(batch.quantityUnitsRemaining || batch.quantity_units_remaining || 0),
      batch.expiryDate || batch.expiry_date || new Date(Date.now() + 365 * 24 * 3600 * 1000),
    );
  }

  /**
   * Sync Expense record
   */
  private async syncExpense(payload: any) {
    const rawSchema = payload.schemaName || payload.schema;
    if (!rawSchema) throw new Error('Expense payload missing schemaName');
    const schema = validateAndSanitizeSchemaName(rawSchema);

    const expense = payload.expense || payload;
    const expenseId = expense.id || crypto.randomUUID();

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".expenses 
       (id, category, title, amount, expense_date, recipient, notes, created_at) 
       VALUES ($1::uuid, $2, $3, $4, $5::timestamp, $6, $7, NOW())
       ON CONFLICT (id) DO NOTHING`,
      expenseId,
      expense.category || 'OTHER',
      expense.title || 'مصروف مزامنة',
      Number(expense.amount || 0),
      expense.expenseDate || expense.expense_date || new Date(),
      expense.recipient || null,
      expense.notes || null,
    );
  }

  /**
   * Sync Purchase Invoice
   */
  private async syncPurchase(payload: any) {
    const rawSchema = payload.schemaName || payload.schema;
    if (!rawSchema) throw new Error('Purchase payload missing schemaName');
    const schema = validateAndSanitizeSchemaName(rawSchema);

    const purchase = payload.purchase || payload;
    const purchaseId = purchase.id || crypto.randomUUID();

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}".purchases 
       (id, invoice_number, total_cost, notes, created_at) 
       VALUES ($1::uuid, $2, $3, $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      purchaseId,
      purchase.invoiceNumber || purchase.invoice_number || `PUR-SYNC-${Date.now()}`,
      Number(purchase.totalCost || purchase.total_cost || 0),
      purchase.notes || 'مزامنة أوفلاين',
    );
  }

  /**
   * Enqueue a new item to be synchronized to cloud
   */
  public enqueue(tableName: string, action: string, payload: any) {
    try {
      this.localDb.execute(
        'INSERT INTO sync_queue (action, table_name, payload) VALUES (?, ?, ?)',
        [action, tableName, JSON.stringify(payload)],
      );
    } catch (err: any) {
      this.logger.error(`Error enqueuing cloud sync payload: ${err.message}`);
    }
  }

  /**
   * Get sync queue diagnostics status
   */
  public getQueueStatus() {
    try {
      const counts = this.localDb.query<{ synced: number; count: number }>(
        'SELECT synced, COUNT(*) as count FROM sync_queue GROUP BY synced',
      );
      const result = { pending: 0, completed: 0, deadLetterFailed: 0, total: 0 };
      for (const row of counts) {
        if (row.synced === 0) result.pending = row.count;
        else if (row.synced === 1) result.completed = row.count;
        else if (row.synced === -1) result.deadLetterFailed = row.count;
        result.total += row.count;
      }
      return result;
    } catch (err: any) {
      return { pending: 0, completed: 0, deadLetterFailed: 0, total: 0, error: err.message };
    }
  }
}
