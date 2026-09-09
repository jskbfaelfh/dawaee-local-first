import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  LinkBranchDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './dto/chain.dto';

@Injectable()
export class ChainService {
  private readonly logger = new Logger(ChainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Get Chain Overview, financial KPIs across branches, and list of all branches
   */
  async getChainOverview() {
    const tenantId = this.tenantContext.getTenantId();
    const currentTenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { chain: true },
    });

    if (!currentTenant) {
      throw new NotFoundException('الصيدلية غير موجودة');
    }

    let chain = currentTenant.chain;
    let memberTenants: any[] = [];

    if (chain) {
      memberTenants = await this.prisma.tenant.findMany({
        where: { chainId: chain.id },
        orderBy: { createdAt: 'asc' },
      });
    } else {
      memberTenants = [currentTenant];
    }

    // Collect metrics for each member tenant
    const branchesMetrics: any[] = [];
    let totalTodaySales = 0;
    let totalMonthSales = 0;
    let totalInventoryValuation = 0;

    for (const t of memberTenants) {
      let todaySales = 0;
      let monthSales = 0;
      let inventoryCount = 0;
      let inventoryValue = 0;
      let outOfStockCount = 0;

      try {
        // 1. Today Sales
        const todaySalesRow: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT COALESCE(SUM(total_amount), 0)::numeric as "todaySales"
          FROM "${t.schemaName}".sales
          WHERE DATE(sale_date) = CURRENT_DATE;
        `);
        todaySales = Number(todaySalesRow[0]?.todaySales || 0);

        // 2. Month Sales
        const monthSalesRow: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT COALESCE(SUM(total_amount), 0)::numeric as "monthSales"
          FROM "${t.schemaName}".sales
          WHERE sale_date >= DATE_TRUNC('month', CURRENT_DATE);
        `);
        monthSales = Number(monthSalesRow[0]?.monthSales || 0);

        // 3. Inventory Valuation & Out of Stock
        const invRow: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT 
            COUNT(DISTINCT i.id)::int as "totalItems",
            COALESCE(SUM(b.quantity_units_remaining * (COALESCE(b.purchase_price_pack, 0) / GREATEST(1, COALESCE(b.units_per_pack, 1)))), 0)::numeric as "totalValue"
          FROM "${t.schemaName}".inventory_items i
          LEFT JOIN "${t.schemaName}".inventory_batches b ON i.id = b.inventory_item_id AND b.quantity_units_remaining > 0;
        `);
        inventoryCount = Number(invRow[0]?.totalItems || 0);
        inventoryValue = Math.round(Number(invRow[0]?.totalValue || 0));

        // 4. Out of stock count
        const oosRow: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int as "oos"
          FROM "${t.schemaName}".inventory_items i
          WHERE NOT EXISTS (
            SELECT 1 FROM "${t.schemaName}".inventory_batches b 
            WHERE b.inventory_item_id = i.id AND b.quantity_units_remaining > 0
          );
        `);
        outOfStockCount = Number(oosRow[0]?.oos || 0);
      } catch (err) {
        this.logger.warn(`Could not compute metrics for branch schema ${t.schemaName}: ${err.message}`);
      }

      totalTodaySales += todaySales;
      totalMonthSales += monthSales;
      totalInventoryValuation += inventoryValue;

      branchesMetrics.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        governorate: t.governorate,
        district: t.district,
        phone: t.phone,
        chainRole: t.chainRole || 'BRANCH',
        isCurrent: t.id === currentTenant.id,
        subscriptionStatus: t.subscriptionStatus,
        metrics: {
          todaySales,
          monthSales,
          inventoryCount,
          inventoryValue,
          outOfStockCount,
        },
      });
    }

    // Pending transfers count for this chain
    let pendingTransfersCount = 0;
    if (chain) {
      pendingTransfersCount = await this.prisma.stockTransfer.count({
        where: {
          chainId: chain.id,
          status: 'PENDING',
        },
      });
    }

    return {
      chain: chain
        ? {
            id: chain.id,
            name: chain.name,
            ownerName: chain.ownerName,
            ownerPhone: chain.ownerPhone,
            totalBranches: memberTenants.length,
          }
        : null,
      currentBranchId: currentTenant.id,
      summary: {
        totalBranches: memberTenants.length,
        totalTodaySales,
        totalMonthSales,
        totalInventoryValuation,
        pendingTransfersCount,
      },
      branches: branchesMetrics,
    };
  }

  /**
   * Link an existing branch to the Owner's chain using Slug and License Key
   */
  async linkBranch(dto: LinkBranchDto) {
    const tenantId = this.tenantContext.getTenantId();
    const currentTenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { chain: true },
    });

    if (!currentTenant) {
      throw new NotFoundException('الصيدلية غير موجودة');
    }

    // 1. Verify Target Tenant by slug & licenseKey
    const targetTenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.targetSlug.trim() },
    });

    if (!targetTenant) {
      throw new NotFoundException('الفرع المطلوب ربطه غير موجود في النظام، تحقق من اسم المعرف (slug)');
    }

    if (targetTenant.id === currentTenant.id) {
      throw new BadRequestException('لا يمكنك ربط الفرع بنفسه');
    }

    if (targetTenant.licenseKey.trim() !== dto.licenseKey.trim()) {
      throw new BadRequestException('كود ترخيص الفرع غير صحيح');
    }

    // 2. Ensure or Create PharmacyChain
    let chainId = currentTenant.chainId;

    if (!chainId) {
      // Create new chain
      const newChain = await this.prisma.pharmacyChain.create({
        data: {
          name: dto.chainName || `مجموعة ${currentTenant.name}`,
          ownerName: currentTenant.name,
          ownerPhone: currentTenant.phone,
        },
      });
      chainId = newChain.id;

      // Assign current tenant as HQ
      await this.prisma.tenant.update({
        where: { id: currentTenant.id },
        data: {
          chainId: newChain.id,
          chainRole: 'HQ',
        },
      });
    }

    // 3. Link target tenant to this chain
    await this.prisma.tenant.update({
      where: { id: targetTenant.id },
      data: {
        chainId: chainId,
        chainRole: 'BRANCH',
      },
    });

    this.logger.log(`Branch "${targetTenant.name}" linked successfully to chain ${chainId}`);

    return {
      success: true,
      message: `تم ربط الفرع (${targetTenant.name}) بنجاح إلى شبكة فروعك!`,
      chainId,
    };
  }

  /**
   * Check cross-branch stock availability for a specific medicine across all chain branches
   */
  async checkCrossBranchStock(medicineId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const currentTenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!currentTenant) {
      throw new NotFoundException('الصيدلية غير موجودة');
    }

    // If no chain, return single branch status
    let memberTenants: any[] = [];
    if (currentTenant.chainId) {
      memberTenants = await this.prisma.tenant.findMany({
        where: { chainId: currentTenant.chainId },
        orderBy: { createdAt: 'asc' },
      });
    } else {
      memberTenants = [currentTenant];
    }

    const results: any[] = [];

    for (const t of memberTenants) {
      try {
        const rows: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT 
            i.id as "inventoryItemId",
            COALESCE(i.custom_name, m.trade_name) as "tradeName",
            m.scientific_name as "scientificName",
            i.shelf_location as "shelfLocation",
            COALESCE(i.units_per_pack, m.default_units_per_pack, 1) as "unitsPerPack",
            COALESCE(i.selling_price_pack, 0) as "sellingPricePack",
            COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining"
          FROM "${t.schemaName}".inventory_items i
          JOIN public.medicines m ON i.medicine_id = m.id
          LEFT JOIN "${t.schemaName}".inventory_batches b ON i.id = b.inventory_item_id 
            AND b.quantity_units_remaining > 0
            AND b.expiry_date >= CURRENT_DATE 
            AND (b.is_recalled IS FALSE OR b.is_recalled IS NULL)
          WHERE i.medicine_id = $1::uuid
          GROUP BY i.id, m.id;
        `, medicineId);

        if (rows.length > 0) {
          const r = rows[0];
          const totalUnits = Number(r.totalUnitsRemaining || 0);
          const unitsPerPack = Number(r.unitsPerPack || 1);
          const availablePacks = Math.floor(totalUnits / unitsPerPack);
          const availableStrips = totalUnits % unitsPerPack;

          results.push({
            tenantId: t.id,
            pharmacyName: t.name,
            governorate: t.governorate,
            district: t.district,
            phone: t.phone,
            isCurrent: t.id === currentTenant.id,
            tradeName: r.tradeName,
            shelfLocation: r.shelfLocation || null,
            totalUnitsRemaining: totalUnits,
            availablePacks,
            availableStrips,
            sellingPricePack: Number(r.sellingPricePack),
            isAvailable: totalUnits > 0,
          });
        } else {
          results.push({
            tenantId: t.id,
            pharmacyName: t.name,
            governorate: t.governorate,
            district: t.district,
            phone: t.phone,
            isCurrent: t.id === currentTenant.id,
            tradeName: '—',
            shelfLocation: null,
            totalUnitsRemaining: 0,
            availablePacks: 0,
            availableStrips: 0,
            sellingPricePack: 0,
            isAvailable: false,
          });
        }
      } catch (err) {
        this.logger.warn(`Could not check medicine in branch ${t.name}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Create an inter-branch stock transfer (Deduct from source and create PENDING transfer atomically)
   */
  async createStockTransfer(dto: CreateStockTransferDto) {
    const tenantId = this.tenantContext.getTenantId();
    const schemaName = this.tenantContext.getSchemaName();
    const ctx = this.tenantContext.getContext();

    return this.prisma.$transaction(async (tx) => {
      const currentTenant = await tx.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!currentTenant || !currentTenant.chainId) {
        throw new BadRequestException('يجب أن تكون الصيدلية مرتبطة بسلسلة فروع لإجراء مناقلة مخزنية');
      }

      const targetTenant = await tx.tenant.findUnique({
        where: { id: dto.targetTenantId },
      });

      if (!targetTenant || targetTenant.chainId !== currentTenant.chainId) {
        throw new BadRequestException('الفرع المستلم غير مسجل ضمن نفس السلسلة');
      }

      if (targetTenant.id === currentTenant.id) {
        throw new BadRequestException('لا يمكن التحويل لنفس الفرع');
      }

      // 1. Check medicine & available batch in source schema
      const itemRows: any[] = await tx.$queryRawUnsafe(`
        SELECT i.id, i.units_per_pack, COALESCE(i.custom_name, m.trade_name) as "tradeName"
        FROM "${schemaName}".inventory_items i
        JOIN public.medicines m ON i.medicine_id = m.id
        WHERE i.medicine_id = $1::uuid
        LIMIT 1;
      `, dto.medicineId);

      if (itemRows.length === 0) {
        throw new NotFoundException('الدواء غير موجود في مخزون الفرع الحالي');
      }

      const item = itemRows[0];
      const unitsPerPack = item.units_per_pack || 1;
      const totalUnitsToTransfer = (dto.quantityPacks * unitsPerPack) + (dto.quantityUnits || 0);

      // 2. Fetch and LOCK source batches to deduct from (FIFO)
      let batchQuery = `
        SELECT id, batch_number, expiry_date, quantity_units_remaining, purchase_price_pack
        FROM "${schemaName}".inventory_batches
        WHERE inventory_item_id = $1::uuid AND quantity_units_remaining > 0
      `;
      const params: any[] = [item.id];

      if (dto.batchNumber) {
        batchQuery += ` AND batch_number = $2`;
        params.push(dto.batchNumber);
      }
      batchQuery += ` ORDER BY expiry_date ASC, id ASC FOR UPDATE;`;

      const availableBatches: any[] = await tx.$queryRawUnsafe(batchQuery, ...params);
      const totalAvailable = availableBatches.reduce((sum, b) => sum + Number(b.quantity_units_remaining), 0);

      if (totalAvailable < totalUnitsToTransfer) {
        throw new BadRequestException(`الكمية المتوفرة في المخزون (${totalAvailable} وحدة) أقل من الكمية المراد تحويلها (${totalUnitsToTransfer} وحدة)`);
      }

      // 3. Deduct from source batches and record exact multi-batch allocations
      let remainingToDeduct = totalUnitsToTransfer;
      let selectedBatchNumber = dto.batchNumber || null;
      let selectedExpiry: any = null;
      let avgPurchasePrice = 0;
      const batchAllocations: Array<{
        batchId: string;
        batchNumber: string;
        expiryDate: string | null;
        units: number;
        purchasePricePack: number;
      }> = [];

      for (const b of availableBatches) {
        if (remainingToDeduct <= 0) break;
        const bUnits = Number(b.quantity_units_remaining);
        const deductFromThis = Math.min(bUnits, remainingToDeduct);

        await tx.$executeRawUnsafe(`
          UPDATE "${schemaName}".inventory_batches
          SET quantity_units_remaining = quantity_units_remaining - $1
          WHERE id = $2::uuid;
        `, deductFromThis, b.id);

        remainingToDeduct -= deductFromThis;
        if (!selectedBatchNumber) selectedBatchNumber = b.batch_number;
        if (!selectedExpiry) selectedExpiry = b.expiry_date;
        avgPurchasePrice = Number(b.purchase_price_pack || 0);

        batchAllocations.push({
          batchId: b.id,
          batchNumber: b.batch_number,
          expiryDate: b.expiry_date ? new Date(b.expiry_date).toISOString().slice(0, 10) : null,
          units: deductFromThis,
          purchasePricePack: Number(b.purchase_price_pack || 0),
        });
      }

      // 4. Create StockTransfer record in Master DB with batchAllocations
      const transferNumber = `TRF-${Date.now().toString().slice(-6)}`;
      const transfer = await tx.stockTransfer.create({
        data: {
          transferNumber,
          chainId: currentTenant.chainId,
          sourceTenantId: currentTenant.id,
          targetTenantId: targetTenant.id,
          sourcePharmacyName: currentTenant.name,
          targetPharmacyName: targetTenant.name,
          medicineId: dto.medicineId,
          tradeName: item.tradeName,
          batchNumber: selectedBatchNumber,
          expiryDate: selectedExpiry ? new Date(selectedExpiry) : null,
          quantityPacks: dto.quantityPacks,
          quantityUnits: totalUnitsToTransfer,
          purchasePricePack: avgPurchasePrice,
          status: 'PENDING',
          notes: dto.notes || null,
          batchAllocations: batchAllocations as any,
          senderUserName: (ctx as any)?.name || 'صاحب الصيدلية',
        },
      });

      return {
        success: true,
        message: `تم إنشاء سند المناقلة رقم (${transferNumber}) وإرسال الشحنة إلى (${targetTenant.name}) بنجاح`,
        transfer,
      };
    });
  }

  /**
   * Receive and confirm an incoming stock transfer (Adds to target branch inventory batches)
   */
  async receiveStockTransfer(transferId: string, dto: ReceiveStockTransferDto) {
    const tenantId = this.tenantContext.getTenantId();
    const schemaName = this.tenantContext.getSchemaName();
    const ctx = this.tenantContext.getContext();

    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
      });

      if (!transfer) {
        throw new NotFoundException('سند المناقلة غير موجود');
      }

      if (transfer.targetTenantId !== tenantId) {
        throw new ForbiddenException('هذه الشحنة ليست موجهة لصيدليتك الحالية');
      }

      if (transfer.status !== 'PENDING') {
        throw new BadRequestException(`لا يمكن استلام الشحنة، حالتها الحالية (${transfer.status})`);
      }

      // 1. Ensure medicine exists in target inventory_items
      let itemRows: any[] = await tx.$queryRawUnsafe(`
        SELECT id, units_per_pack, selling_price_pack, selling_price_unit FROM "${schemaName}".inventory_items
        WHERE medicine_id = $1::uuid
        LIMIT 1;
      `, transfer.medicineId);

      let inventoryItemId: string;
      let unitsPerPack = 1;
      let targetSellingPricePack = 0;
      let targetSellingPriceUnit = 0;

      if (itemRows.length === 0) {
        // Get medicine default units
        const med = await tx.medicine.findUnique({
          where: { id: transfer.medicineId },
        });
        unitsPerPack = med?.defaultUnitsPerPack || 1;
        targetSellingPricePack = Number(med?.defaultPurchasePrice || transfer.purchasePricePack || 0) * 1.25;
        targetSellingPriceUnit = unitsPerPack > 0 ? targetSellingPricePack / unitsPerPack : targetSellingPricePack;

        const newIdRows: any[] = await tx.$queryRawUnsafe(`
          INSERT INTO "${schemaName}".inventory_items (
            id, medicine_id, units_per_pack, selling_price_pack, selling_price_unit, shelf_location, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2, $3, $4, $5, NOW(), NOW()
          ) RETURNING id;
        `, transfer.medicineId, unitsPerPack, targetSellingPricePack, targetSellingPriceUnit, dto.shelfLocation || null);

        inventoryItemId = newIdRows[0].id;
      } else {
        inventoryItemId = itemRows[0].id;
        unitsPerPack = itemRows[0].units_per_pack || 1;
        targetSellingPricePack = Number(itemRows[0].selling_price_pack || 0);
        targetSellingPriceUnit = Number(itemRows[0].selling_price_unit || 0);

        if (dto.shelfLocation) {
          await tx.$executeRawUnsafe(`
            UPDATE "${schemaName}".inventory_items
            SET shelf_location = $1, updated_at = NOW()
            WHERE id = $2::uuid;
          `, dto.shelfLocation, inventoryItemId);
        }
      }

      // 2. Insert Batches into target inventory_batches preserving multi-batch allocations
      const allocations: Array<{
        batchId?: string;
        batchNumber?: string;
        expiryDate?: string | Date | null;
        units: number;
        purchasePricePack?: number;
      }> = (Array.isArray(transfer.batchAllocations) && (transfer.batchAllocations as any[]).length > 0)
        ? (transfer.batchAllocations as any[])
        : [{
            batchId: undefined,
            batchNumber: transfer.batchNumber || `TRF-${transfer.transferNumber}`,
            expiryDate: transfer.expiryDate,
            units: transfer.quantityUnits,
            purchasePricePack: Number(transfer.purchasePricePack || 0),
          }];

      for (const alloc of allocations) {
        const bNumber = alloc.batchNumber || transfer.batchNumber || `TRF-${transfer.transferNumber}`;
        const expiryStr = alloc.expiryDate 
          ? (typeof alloc.expiryDate === 'string' ? alloc.expiryDate.slice(0, 10) : new Date(alloc.expiryDate).toISOString().slice(0, 10))
          : (transfer.expiryDate ? new Date(transfer.expiryDate).toISOString().slice(0, 10) : '2028-12-31');
        const bPrice = alloc.purchasePricePack ?? Number(transfer.purchasePricePack || 0);

        await tx.$executeRawUnsafe(`
          INSERT INTO "${schemaName}".inventory_batches (
            id, inventory_item_id, batch_number, expiry_date,
            quantity_units_remaining, purchase_price_pack,
            selling_price_pack, selling_price_unit,
            is_recalled, created_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2, $3::date,
            $4, $5,
            $6, $7,
            FALSE, NOW()
          );
        `,
          inventoryItemId,
          bNumber,
          expiryStr,
          Number(alloc.units),
          bPrice,
          targetSellingPricePack,
          targetSellingPriceUnit,
        );
      }

      // 3. Mark transfer as COMPLETED
      const updatedTransfer = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'COMPLETED',
          receiverUserName: (ctx as any)?.name || 'مستلم الفرع',
          completedAt: new Date(),
        },
      });

      return {
        success: true,
        message: `تم استلام الشحنة (${transfer.quantityPacks} علبة من ${transfer.tradeName}) بنجاح وإضافتها إلى مخزون الرفوف`,
        transfer: updatedTransfer,
      };
    });
  }

  /**
   * Cancel a pending transfer and refund units back to source batches atomically
   */
  async cancelStockTransfer(transferId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const schemaName = this.tenantContext.getSchemaName();

    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
      });

      if (!transfer) {
        throw new NotFoundException('سند المناقلة غير موجود');
      }

      if (transfer.sourceTenantId !== tenantId) {
        throw new ForbiddenException('فقط الفرع المرسل يمكنه إلغاء سند المناقلة');
      }

      if (transfer.status !== 'PENDING') {
        throw new BadRequestException('لا يمكن إلغاء شحنة مكتملة أو ملغاة بالفعل');
      }

      // Refund units back to source inventory
      const itemRows: any[] = await tx.$queryRawUnsafe(`
        SELECT id, selling_price_pack, selling_price_unit FROM "${schemaName}".inventory_items WHERE medicine_id = $1::uuid LIMIT 1;
      `, transfer.medicineId);

      if (itemRows.length > 0) {
        const itemId = itemRows[0].id;
        const allocations: Array<{
          batchId?: string;
          batchNumber?: string;
          expiryDate?: string | Date | null;
          units: number;
          purchasePricePack?: number;
        }> = (Array.isArray(transfer.batchAllocations) && (transfer.batchAllocations as any[]).length > 0)
          ? (transfer.batchAllocations as any[])
          : [{
              batchId: undefined,
              batchNumber: transfer.batchNumber || 'TRANSFER',
              expiryDate: transfer.expiryDate,
              units: transfer.quantityUnits,
              purchasePricePack: Number(transfer.purchasePricePack || 0),
            }];

        for (const alloc of allocations) {
          let refunded = false;

          // A. If exact source batchId is known, lock and refund directly to it
          if (alloc.batchId) {
            const existingBatch: any[] = await tx.$queryRawUnsafe(`
              SELECT id FROM "${schemaName}".inventory_batches
              WHERE id = $1::uuid
              FOR UPDATE;
            `, alloc.batchId);

            if (existingBatch.length > 0) {
              await tx.$executeRawUnsafe(`
                UPDATE "${schemaName}".inventory_batches
                SET quantity_units_remaining = quantity_units_remaining + $1
                WHERE id = $2::uuid;
              `, Number(alloc.units), alloc.batchId);
              refunded = true;
            }
          }

          // B. If not refunded yet, find matching batch by batch_number + item_id
          if (!refunded && alloc.batchNumber) {
            const batchRows: any[] = await tx.$queryRawUnsafe(`
              SELECT id FROM "${schemaName}".inventory_batches 
              WHERE inventory_item_id = $1::uuid AND batch_number = $2 
              LIMIT 1
              FOR UPDATE;
            `, itemId, alloc.batchNumber);

            if (batchRows.length > 0) {
              await tx.$executeRawUnsafe(`
                UPDATE "${schemaName}".inventory_batches
                SET quantity_units_remaining = quantity_units_remaining + $1
                WHERE id = $2::uuid;
              `, Number(alloc.units), batchRows[0].id);
              refunded = true;
            }
          }

          // C. Fallback: recreate batch if missing
          if (!refunded) {
            const bNum = alloc.batchNumber || 'CANCELLED-REFUND';
            const bExpiry = alloc.expiryDate 
              ? (typeof alloc.expiryDate === 'string' ? alloc.expiryDate.slice(0, 10) : new Date(alloc.expiryDate).toISOString().slice(0, 10))
              : (transfer.expiryDate ? new Date(transfer.expiryDate).toISOString().slice(0, 10) : null);
            const bPrice = alloc.purchasePricePack ?? Number(transfer.purchasePricePack || 0);

            await tx.$executeRawUnsafe(`
              INSERT INTO "${schemaName}".inventory_batches (
                id, inventory_item_id, batch_number, expiry_date,
                quantity_units_remaining, purchase_price_pack,
                selling_price_pack, selling_price_unit,
                is_recalled, created_at
              ) VALUES (
                gen_random_uuid(), $1::uuid, $2, COALESCE($3::date, CURRENT_DATE + 365),
                $4, $5,
                $6, $7,
                FALSE, NOW()
              );
            `, itemId, bNum, bExpiry, Number(alloc.units), bPrice, Number(itemRows[0].selling_price_pack || 0), Number(itemRows[0].selling_price_unit || 0));
          }
        }
      }

      await tx.stockTransfer.update({
        where: { id: transferId },
        data: { status: 'CANCELLED' },
      });

      return {
        success: true,
        message: 'تم إلغاء سند المناقلة وإعادة الكميات لمخزون الفرع بنجاح',
      };
    });
  }

  /**
   * Get transfers list (Incoming / Outgoing / All)
   */
  async getTransfers(filter: 'ALL' | 'INCOMING' | 'OUTGOING' = 'ALL') {
    const tenantId = this.tenantContext.getTenantId();

    const where: any = {};
    if (filter === 'INCOMING') {
      where.targetTenantId = tenantId;
    } else if (filter === 'OUTGOING') {
      where.sourceTenantId = tenantId;
    } else {
      where.OR = [
        { sourceTenantId: tenantId },
        { targetTenantId: tenantId },
      ];
    }

    return this.prisma.stockTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
