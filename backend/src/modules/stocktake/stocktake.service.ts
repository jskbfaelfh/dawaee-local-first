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
import {
  CreateStocktakeSessionDto,
  RecordItemCountDto,
  ReconcileStocktakeDto,
  StocktakeStatus,
  StocktakeType,
} from './dto/stocktake.dto';

@Injectable()
export class StocktakeService {
  private readonly logger = new Logger(StocktakeService.name);
  private static readonly verifiedSchemas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Helper to ensure stocktake tables exist in the tenant schema
   */
  private async ensureStocktakeTablesExist(schemaName: string) {
    if (StocktakeService.verifiedSchemas.has(schemaName)) {
      return;
    }

    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".stocktake_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(255) NOT NULL,
          type VARCHAR(50) NOT NULL DEFAULT 'ANNUAL',
          status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
          shelf_filter VARCHAR(100),
          notes TEXT,
          total_system_items INT DEFAULT 0,
          total_counted_items INT DEFAULT 0,
          total_variance_units INT DEFAULT 0,
          total_deficit_cost DECIMAL(14, 2) DEFAULT 0,
          total_surplus_cost DECIMAL(14, 2) DEFAULT 0,
          net_variance_cost DECIMAL(14, 2) DEFAULT 0,
          created_by_user_id UUID,
          created_by_name VARCHAR(150),
          reconciled_by_user_id UUID,
          reconciled_by_name VARCHAR(150),
          reconciled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".stocktake_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID NOT NULL REFERENCES "${schemaName}".stocktake_sessions(id) ON DELETE CASCADE,
          inventory_item_id UUID NOT NULL,
          medicine_id UUID,
          trade_name VARCHAR(255) NOT NULL,
          scientific_name VARCHAR(255),
          dosage_form VARCHAR(100),
          strength VARCHAR(100),
          barcode VARCHAR(100),
          shelf_location VARCHAR(100),
          units_per_pack INT NOT NULL DEFAULT 1,
          purchase_price_pack DECIMAL(12, 2) DEFAULT 0,
          selling_price_pack DECIMAL(12, 2) DEFAULT 0,
          system_units INT NOT NULL DEFAULT 0,
          system_packs INT NOT NULL DEFAULT 0,
          system_loose INT NOT NULL DEFAULT 0,
          counted_packs INT DEFAULT 0,
          counted_loose INT DEFAULT 0,
          counted_total_units INT DEFAULT 0,
          variance_units INT DEFAULT 0,
          variance_packs NUMERIC(10, 2) DEFAULT 0,
          variance_cost DECIMAL(14, 2) DEFAULT 0,
          variance_retail DECIMAL(14, 2) DEFAULT 0,
          variance_status VARCHAR(20) DEFAULT 'UNCOUNTED',
          counted_at TIMESTAMP,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_stocktake_items_session ON "${schemaName}".stocktake_items(session_id);
      `);

      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_stocktake_items_barcode ON "${schemaName}".stocktake_items(barcode);
      `);

      StocktakeService.verifiedSchemas.add(schemaName);
    } catch (err) {
      this.logger.error(`Failed to ensure stocktake tables for schema ${schemaName}:`, err);
      throw err;
    }
  }

  /**
   * 1. Create a new Stocktake Session (Annual, Semi-Annual, or Sectional)
   * Automatically and atomically snapshots all current inventory items, theoretical quantities,
   * and calculates true Weighted Average Cost (WAC) based on active batch quantities.
   */
  async createSession(dto: CreateStocktakeSessionDto, user: any) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensureStocktakeTablesExist(schemaName);

    const sessionId = crypto.randomUUID();
    const type = dto.type || StocktakeType.ANNUAL;
    const shelfFilter = dto.shelfFilter?.trim() || null;

    let shelfCondition = '';
    const sqlParams: any[] = [sessionId];
    if (shelfFilter) {
      sqlParams.push(shelfFilter);
      shelfCondition = `WHERE ii.shelf_location = $2`;
    }

    try {
      // 1.1 Insert Session record
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "${schemaName}".stocktake_sessions
         (id, title, type, status, shelf_filter, notes, created_by_user_id, created_by_name, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, 'IN_PROGRESS', $4, $5, $6::uuid, $7, NOW(), NOW())`,
        sessionId,
        dto.title.trim(),
        type,
        shelfFilter,
        dto.notes || null,
        user?.id || null,
        user?.name || 'مدير الصيدلية',
      );

      // 1.2 High-Performance Atomic Snapshot with Weighted Average Cost (WAC)
      // Solves Point 10 (Transaction atomicity) and Point 11 (Weighted Moving Average Cost)
      const insertSql = `
        INSERT INTO "${schemaName}".stocktake_items (
          id, session_id, inventory_item_id, medicine_id, trade_name, scientific_name,
          dosage_form, strength, barcode, shelf_location, units_per_pack,
          purchase_price_pack, selling_price_pack, system_units, system_packs,
          system_loose, variance_status, created_at, updated_at
        )
        SELECT 
          gen_random_uuid(),
          $1::uuid,
          sub."inventoryItemId",
          sub."medicineId",
          sub."tradeName",
          sub."scientificName",
          sub."dosageForm",
          sub."strength",
          sub."barcode",
          sub."shelfLocation",
          sub."unitsPerPack",
          ROUND(sub."weightedAvgCostPack", 2),
          ROUND(sub."sellingPricePack", 2),
          sub."systemUnits",
          FLOOR(sub."systemUnits" / sub."unitsPerPack")::int,
          (sub."systemUnits" % sub."unitsPerPack")::int,
          'UNCOUNTED',
          NOW(),
          NOW()
        FROM (
          SELECT 
            ii.id as "inventoryItemId",
            ii.medicine_id as "medicineId",
            COALESCE(ii.custom_name, m.trade_name) as "tradeName",
            m.scientific_name as "scientificName",
            m.dosage_form as "dosageForm",
            m.strength,
            m.barcode,
            ii.shelf_location as "shelfLocation",
            GREATEST(ii.units_per_pack, 1)::int as "unitsPerPack",
            COALESCE(ii.selling_price_pack, 0)::numeric as "sellingPricePack",
            COALESCE(
              CASE 
                WHEN SUM(b.quantity_units_remaining) > 0 
                THEN SUM(b.purchase_price_pack * b.quantity_units_remaining) / SUM(b.quantity_units_remaining)
                ELSE AVG(b.purchase_price_pack)
              END,
              ii.selling_price_pack,
              0
            )::numeric as "weightedAvgCostPack",
            COALESCE(SUM(b.quantity_units_remaining), 0)::int as "systemUnits"
          FROM "${schemaName}".inventory_items ii
          JOIN public.medicines m ON ii.medicine_id = m.id
          LEFT JOIN "${schemaName}".inventory_batches b ON ii.id = b.inventory_item_id AND b.quantity_units_remaining > 0
          ${shelfCondition}
          GROUP BY ii.id, m.id
          ORDER BY COALESCE(ii.custom_name, m.trade_name) ASC
        ) sub;
      `;

      await this.prisma.$executeRawUnsafe(insertSql, ...sqlParams);

      // 1.3 Count snapshot items and update session totals
      const countRes: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int as total FROM "${schemaName}".stocktake_items WHERE session_id = $1::uuid;`,
        sessionId,
      );
      const totalItems = Number(countRes[0]?.total || 0);

      await this.prisma.$executeRawUnsafe(
        `UPDATE "${schemaName}".stocktake_sessions
         SET total_system_items = $1
         WHERE id = $2::uuid`,
        totalItems,
        sessionId,
      );

      return {
        success: true,
        sessionId,
        totalItems,
        message: `تم إنشاء جلسة الجرد بنجاح وإدراج (${totalItems}) مادة للبدء بالعد الفعلي.`,
      };
    } catch (err: any) {
      this.logger.error(`Stocktake session creation failed on schema ${schemaName}: ${err.message}`);
      try {
        await this.prisma.$executeRawUnsafe(`DELETE FROM "${schemaName}".stocktake_items WHERE session_id = $1::uuid;`, sessionId);
        await this.prisma.$executeRawUnsafe(`DELETE FROM "${schemaName}".stocktake_sessions WHERE id = $1::uuid;`, sessionId);
      } catch (rbErr: any) {
        this.logger.error(`Failed to rollback orphaned stocktake session: ${rbErr.message}`);
      }
      throw err;
    }
  }

  /**
   * 2. Get list of all Stocktake Sessions (Archive)
   */
  async getSessions() {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensureStocktakeTablesExist(schemaName);

    const sessions: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        s.id,
        s.title,
        s.type,
        s.status,
        s.shelf_filter as "shelfFilter",
        s.notes,
        s.total_system_items as "totalSystemItems",
        s.total_counted_items as "totalCountedItems",
        s.total_variance_units as "totalVarianceUnits",
        s.total_deficit_cost as "totalDeficitCost",
        s.total_surplus_cost as "totalSurplusCost",
        s.net_variance_cost as "netVarianceCost",
        s.created_by_name as "createdByName",
        s.reconciled_by_name as "reconciledByName",
        s.reconciled_at as "reconciledAt",
        s.created_at as "createdAt",
        s.updated_at as "updatedAt"
      FROM "${schemaName}".stocktake_sessions s
      ORDER BY s.created_at DESC;
    `);

    return sessions;
  }

  /**
   * 3. Get Session Details with Items & Live Variance Summary
   */
  async getSessionDetails(
    sessionId: string,
    options?: { search?: string; shelf?: string; status?: string },
  ) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensureStocktakeTablesExist(schemaName);

    // 3.1 Get Session Info
    const sessions: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM "${schemaName}".stocktake_sessions WHERE id = $1::uuid LIMIT 1`,
      sessionId,
    );

    if (sessions.length === 0) {
      throw new NotFoundException('جلسة الجرد غير موجودة');
    }
    const session = sessions[0];

    // 3.2 Filter items
    const conditions = [`session_id = $1::uuid`];
    const params: any[] = [sessionId];

    if (options?.search && options.search.trim().length > 0) {
      params.push(`%${options.search.trim()}%`);
      const pIdx = params.length;
      conditions.push(`(trade_name ILIKE $${pIdx} OR scientific_name ILIKE $${pIdx} OR barcode ILIKE $${pIdx})`);
    }

    if (options?.shelf && options.shelf !== 'ALL') {
      params.push(options.shelf.trim());
      conditions.push(`shelf_location = $${params.length}`);
    }

    if (options?.status && options.status !== 'ALL') {
      params.push(options.status.trim());
      conditions.push(`variance_status = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const itemsSql = `
      SELECT 
        id,
        session_id as "sessionId",
        inventory_item_id as "inventoryItemId",
        medicine_id as "medicineId",
        trade_name as "tradeName",
        scientific_name as "scientificName",
        dosage_form as "dosageForm",
        strength,
        barcode,
        shelf_location as "shelfLocation",
        units_per_pack as "unitsPerPack",
        purchase_price_pack as "purchasePricePack",
        selling_price_pack as "sellingPricePack",
        system_units as "systemUnits",
        system_packs as "systemPacks",
        system_loose as "systemLoose",
        counted_packs as "countedPacks",
        counted_loose as "countedLoose",
        counted_total_units as "countedTotalUnits",
        variance_units as "varianceUnits",
        variance_packs as "variancePacks",
        variance_cost as "varianceCost",
        variance_retail as "varianceRetail",
        variance_status as "varianceStatus",
        counted_at as "countedAt",
        notes
      FROM "${schemaName}".stocktake_items
      WHERE ${whereClause}
      ORDER BY 
        CASE variance_status 
          WHEN 'SHORTAGE' THEN 1
          WHEN 'SURPLUS' THEN 2
          WHEN 'UNCOUNTED' THEN 3
          ELSE 4
        END,
        trade_name ASC;
    `;

    const items: any[] = await this.prisma.$queryRawUnsafe(itemsSql, ...params);

    // 3.3 Compute Aggregate Stats for the whole session
    const statsSql = `
      SELECT 
        COUNT(*)::int as "totalItems",
        COUNT(CASE WHEN variance_status != 'UNCOUNTED' THEN 1 END)::int as "countedItems",
        COUNT(CASE WHEN variance_status = 'MATCHED' THEN 1 END)::int as "matchedItems",
        COUNT(CASE WHEN variance_status = 'SHORTAGE' THEN 1 END)::int as "shortageItems",
        COUNT(CASE WHEN variance_status = 'SURPLUS' THEN 1 END)::int as "surplusItems",
        COUNT(CASE WHEN variance_status = 'UNCOUNTED' THEN 1 END)::int as "uncountedItems",
        COALESCE(SUM(CASE WHEN variance_units < 0 THEN ABS(variance_cost) ELSE 0 END), 0)::numeric as "totalDeficitCost",
        COALESCE(SUM(CASE WHEN variance_units > 0 THEN variance_cost ELSE 0 END), 0)::numeric as "totalSurplusCost",
        COALESCE(SUM(variance_cost), 0)::numeric as "netVarianceCost",
        COALESCE(SUM(CASE WHEN variance_units < 0 THEN ABS(variance_retail) ELSE 0 END), 0)::numeric as "totalDeficitRetail",
        COALESCE(SUM(CASE WHEN variance_units > 0 THEN variance_retail ELSE 0 END), 0)::numeric as "totalSurplusRetail"
      FROM "${schemaName}".stocktake_items
      WHERE session_id = $1::uuid;
    `;

    const statsRes: any[] = await this.prisma.$queryRawUnsafe(statsSql, sessionId);
    const stats = statsRes[0] || {};

    // 3.4 Get distinct shelves
    const shelvesRes: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT DISTINCT shelf_location FROM "${schemaName}".stocktake_items WHERE session_id = $1::uuid AND shelf_location IS NOT NULL AND shelf_location != '' ORDER BY shelf_location ASC`,
      sessionId,
    );
    const availableShelves = shelvesRes.map((r) => r.shelf_location);

    return {
      session: {
        id: session.id,
        title: session.title,
        type: session.type,
        status: session.status,
        shelfFilter: session.shelf_filter,
        notes: session.notes,
        createdByName: session.created_by_name,
        reconciledByName: session.reconciled_by_name,
        reconciledAt: session.reconciled_at,
        createdAt: session.created_at,
      },
      stats: {
        totalItems: Number(stats.totalItems || 0),
        countedItems: Number(stats.countedItems || 0),
        matchedItems: Number(stats.matchedItems || 0),
        shortageItems: Number(stats.shortageItems || 0),
        surplusItems: Number(stats.surplusItems || 0),
        uncountedItems: Number(stats.uncountedItems || 0),
        progressPercent:
          stats.totalItems > 0
            ? Math.round((Number(stats.countedItems || 0) / Number(stats.totalItems)) * 100)
            : 0,
        totalDeficitCost: Math.round(Number(stats.totalDeficitCost || 0)),
        totalSurplusCost: Math.round(Number(stats.totalSurplusCost || 0)),
        netVarianceCost: Math.round(Number(stats.netVarianceCost || 0)),
        totalDeficitRetail: Math.round(Number(stats.totalDeficitRetail || 0)),
        totalSurplusRetail: Math.round(Number(stats.totalSurplusRetail || 0)),
      },
      availableShelves,
      items,
    };
  }

  /**
   * 4. Record Physical Count for an item (by item ID, barcode, or medicine ID)
   */
  async recordCount(sessionId: string, dto: RecordItemCountDto) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensureStocktakeTablesExist(schemaName);

    // Verify session is in progress
    const sessionCheck: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT status FROM "${schemaName}".stocktake_sessions WHERE id = $1::uuid LIMIT 1`,
      sessionId,
    );
    if (sessionCheck.length === 0) {
      throw new NotFoundException('جلسة الجرد غير موجودة');
    }
    if (sessionCheck[0].status === StocktakeStatus.COMPLETED) {
      throw new BadRequestException('تم اعتماد هذه الجلسة مسبقاً وتسوية مخزونها، لا يمكن تعديلها.');
    }

    // Locate the item in the stocktake session
    let targetItem: any = null;
    if (dto.stocktakeItemId) {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "${schemaName}".stocktake_items WHERE id = $1::uuid AND session_id = $2::uuid LIMIT 1`,
        dto.stocktakeItemId,
        sessionId,
      );
      targetItem = rows[0] || null;
    } else if (dto.barcode && dto.barcode.trim().length > 0) {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "${schemaName}".stocktake_items WHERE barcode = $1 AND session_id = $2::uuid LIMIT 1`,
        dto.barcode.trim(),
        sessionId,
      );
      targetItem = rows[0] || null;
    } else if (dto.medicineId) {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "${schemaName}".stocktake_items WHERE medicine_id = $1::uuid AND session_id = $2::uuid LIMIT 1`,
        dto.medicineId,
        sessionId,
      );
      targetItem = rows[0] || null;
    }

    if (!targetItem) {
      throw new NotFoundException('المادة غير موجودة ضمن جلسة الجرد الحالية');
    }

    // Calculate count and variance
    const unitsPerPack = Number(targetItem.units_per_pack) || 1;
    const countedPacks = Math.max(0, Number(dto.countedPacks || 0));
    const countedLoose = Math.max(0, Number(dto.countedLoose || 0));
    const countedTotalUnits = countedPacks * unitsPerPack + countedLoose;

    const systemUnits = Number(targetItem.system_units) || 0;
    const varianceUnits = countedTotalUnits - systemUnits;
    const variancePacks = Number((varianceUnits / unitsPerPack).toFixed(2));
    const purchasePricePack = Number(targetItem.purchase_price_pack) || 0;
    const sellingPricePack = Number(targetItem.selling_price_pack) || 0;

    const varianceCost = Math.round(variancePacks * purchasePricePack);
    const varianceRetail = Math.round(variancePacks * sellingPricePack);

    let varianceStatus = 'MATCHED';
    if (varianceUnits < 0) {
      varianceStatus = 'SHORTAGE';
    } else if (varianceUnits > 0) {
      varianceStatus = 'SURPLUS';
    }

    // Update stocktake_items
    await this.prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".stocktake_items
       SET counted_packs = $1,
           counted_loose = $2,
           counted_total_units = $3,
           variance_units = $4,
           variance_packs = $5,
           variance_cost = $6,
           variance_retail = $7,
           variance_status = $8,
           counted_at = NOW(),
           notes = COALESCE($9, notes),
           updated_at = NOW()
       WHERE id = $10::uuid`,
      countedPacks,
      countedLoose,
      countedTotalUnits,
      varianceUnits,
      variancePacks,
      varianceCost,
      varianceRetail,
      varianceStatus,
      dto.notes || null,
      targetItem.id,
    );

    // Update Session aggregates
    await this.updateSessionAggregates(schemaName, sessionId);

    return {
      success: true,
      itemId: targetItem.id,
      tradeName: targetItem.trade_name,
      countedPacks,
      countedLoose,
      variancePacks,
      varianceStatus,
      varianceCost,
    };
  }

  /**
   * Helper to recalculate and store session summary stats
   */
  private async updateSessionAggregates(schemaName: string, sessionId: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "${schemaName}".stocktake_sessions
       SET total_counted_items = sub.counted_items,
           total_variance_units = sub.total_variance,
           total_deficit_cost = sub.deficit_cost,
           total_surplus_cost = sub.surplus_cost,
           net_variance_cost = sub.net_variance,
           updated_at = NOW()
       FROM (
         SELECT 
           COUNT(CASE WHEN variance_status != 'UNCOUNTED' THEN 1 END)::int as counted_items,
           COALESCE(SUM(variance_units), 0)::int as total_variance,
           COALESCE(SUM(CASE WHEN variance_units < 0 THEN ABS(variance_cost) ELSE 0 END), 0)::numeric as deficit_cost,
           COALESCE(SUM(CASE WHEN variance_units > 0 THEN variance_cost ELSE 0 END), 0)::numeric as surplus_cost,
           COALESCE(SUM(variance_cost), 0)::numeric as net_variance
         FROM "${schemaName}".stocktake_items
         WHERE session_id = $1::uuid
       ) sub
       WHERE id = $1::uuid`,
      sessionId,
    );
  }

  /**
   * 5. Reconcile Stocktake Session (Apply Physical Count into Real Inventory)
   * Only accessible by OWNER / Authorized Pharmacist.
   */
  async reconcileSession(sessionId: string, dto: ReconcileStocktakeDto, user: any) {
    const schemaName = this.tenantContext.getSchemaName();
    const tenantId = this.tenantContext.getTenantId();
    await this.ensureStocktakeTablesExist(schemaName);

    const affectedMedicineIds: string[] = [];

    // 5.1 Apply Reconciliations into Batches atomically inside transaction with row locks on session
    const adjustedCount = await this.prisma.$transaction(
      async (tx) => {
        // A. Lock and verify session inside transaction
        const sessionRows: any[] = await tx.$queryRawUnsafe(
          `SELECT * FROM "${schemaName}".stocktake_sessions WHERE id = $1::uuid FOR UPDATE`,
          sessionId,
        );
        if (sessionRows.length === 0) {
          throw new NotFoundException('جلسة الجرد غير موجودة');
        }
        const session = sessionRows[0];
        if (session.status === StocktakeStatus.COMPLETED) {
          throw new BadRequestException('تمت تسوية واعتماد هذه الجلسة مسبقاً.');
        }

        // B. Fetch counted items with discrepancies inside transaction
        const discrepancyItems: any[] = await tx.$queryRawUnsafe(
          `SELECT * FROM "${schemaName}".stocktake_items 
           WHERE session_id = $1::uuid AND variance_status IN ('SHORTAGE', 'SURPLUS')`,
          sessionId,
        );

        for (const item of discrepancyItems) {
          const inventoryItemId = item.inventory_item_id;
          const medicineId = item.medicine_id;
          if (medicineId) affectedMedicineIds.push(medicineId);

          const varianceUnits = Number(item.variance_units) || 0;

          if (varianceUnits < 0) {
            // Deficit / Shortage: We need to deduct |varianceUnits| from batches
            let neededDeduction = Math.abs(varianceUnits);

            // Fetch active batches sorted by FEFO (oldest expiry first) with row locks
            const batches: any[] = await tx.$queryRawUnsafe(
              `SELECT id, quantity_units_remaining
               FROM "${schemaName}".inventory_batches
               WHERE inventory_item_id = $1::uuid AND quantity_units_remaining > 0
               ORDER BY expiry_date ASC, created_at ASC
               FOR UPDATE`,
              inventoryItemId,
            );

            for (const b of batches) {
              if (neededDeduction <= 0) break;
              const currentRemaining = Number(b.quantity_units_remaining) || 0;
              const deductFromThisBatch = Math.min(currentRemaining, neededDeduction);

              await tx.$executeRawUnsafe(
                `UPDATE "${schemaName}".inventory_batches
                 SET quantity_units_remaining = GREATEST(0, quantity_units_remaining - $1)
                 WHERE id = $2::uuid`,
                deductFromThisBatch,
                b.id,
              );

              neededDeduction -= deductFromThisBatch;
            }
          } else if (varianceUnits > 0) {
            // Surplus: Restrict to active, non-expired, non-recalled batches
            const candidateBatches: any[] = await tx.$queryRawUnsafe(
              `SELECT id, purchase_price_pack, selling_price_pack, selling_price_unit, expiry_date
               FROM "${schemaName}".inventory_batches
               WHERE inventory_item_id = $1::uuid
                 AND expiry_date >= CURRENT_DATE
                 AND (is_recalled IS FALSE OR is_recalled IS NULL)
               ORDER BY expiry_date DESC, created_at DESC 
               LIMIT 1
               FOR UPDATE`,
              inventoryItemId,
            );

            if (candidateBatches.length > 0) {
              await tx.$executeRawUnsafe(
                `UPDATE "${schemaName}".inventory_batches
                 SET quantity_units_remaining = quantity_units_remaining + $1
                 WHERE id = $2::uuid`,
                varianceUnits,
                candidateBatches[0].id,
              );
            } else {
              // Create an adjustment batch
              const newBatchId = crypto.randomUUID();
              const nextYear = new Date().getFullYear() + 2;
              await tx.$executeRawUnsafe(
                `INSERT INTO "${schemaName}".inventory_batches
                 (id, inventory_item_id, batch_number, purchase_price_pack, selling_price_pack, selling_price_unit, quantity_units_remaining, expiry_date, is_recalled, is_bonus, created_at)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date, FALSE, FALSE, NOW())`,
                newBatchId,
                inventoryItemId,
                null, // Strictly null: no fabricated batch numbers
                item.purchase_price_pack || 0,
                item.selling_price_pack || 0,
                item.units_per_pack > 1 ? Math.round(item.selling_price_pack / item.units_per_pack) : item.selling_price_pack,
                varianceUnits,
                `${nextYear}-12-01`,
              );
            }
          }
        }

        // C. Mark Session as COMPLETED
        await tx.$executeRawUnsafe(
          `UPDATE "${schemaName}".stocktake_sessions
           SET status = 'COMPLETED',
               reconciled_by_user_id = $1::uuid,
               reconciled_by_name = $2,
               reconciled_at = NOW(),
               notes = COALESCE($3, notes),
               updated_at = NOW()
           WHERE id = $4::uuid`,
          user?.id || null,
          user?.name || 'مدير الصيدلية',
          dto.notes || null,
          sessionId,
        );

        return discrepancyItems.length;
      },
      { timeout: 60000, maxWait: 15000 },
    );

    // 5.5 Emit Live Inventory Sync Event to update all POS clients & inventory views
    this.eventEmitter.emit('inventory.synced', {
      tenantId,
      schemaName,
      medicineIds: affectedMedicineIds,
    });

    return {
      success: true,
      message: `تم اعتماد محضر الجرد وتسوية المخزن بنجاح! تم تعديل أرصدة (${adjustedCount}) مادة في المخزن.`,
      adjustedItemsCount: adjustedCount,
    };
  }

  /**
   * 6. Delete a draft / in-progress session
   */
  async deleteSession(sessionId: string) {
    const schemaName = this.tenantContext.getSchemaName();
    await this.ensureStocktakeTablesExist(schemaName);

    const sessionCheck: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT status FROM "${schemaName}".stocktake_sessions WHERE id = $1::uuid LIMIT 1`,
      sessionId,
    );
    if (sessionCheck.length === 0) {
      throw new NotFoundException('جلسة الجرد غير موجودة');
    }
    if (sessionCheck[0].status === StocktakeStatus.COMPLETED) {
      throw new BadRequestException('لا يمكن حذف جلسة جرد تم اعتمادها وتسويتها مسبقاً.');
    }

    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "${schemaName}".stocktake_sessions WHERE id = $1::uuid`,
      sessionId,
    );

    return { success: true, message: 'تم حذف جلسة الجرد بنجاح' };
  }
}
