import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { DateRangeDto } from './dto/date-range.dto';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Financial Profit & Loss Report for a given date range
   */
  async getFinancialReport(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    let dateFilter = '';
    const params: any[] = [];

    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `WHERE s.created_at >= $1::timestamp AND s.created_at <= $2::timestamp`;
    } else if (dto.from) {
      params.push(`${dto.from} 00:00:00`);
      dateFilter = `WHERE s.created_at >= $1::timestamp`;
    }

    // 1. Calculate Sales Revenue & Discounts
    const salesSql = `
      SELECT 
        COUNT(s.id)::int as "totalInvoicesCount",
        COALESCE(SUM(s.subtotal), 0)::numeric as "grossSales",
        COALESCE(SUM(s.discount_amount), 0)::numeric as "totalDiscounts",
        COALESCE(SUM(s.total_amount), 0)::numeric as "netRevenue"
      FROM "${schemaName}".sales s
      ${dateFilter};
    `;
    const salesStats: any[] = await this.prisma.$queryRawUnsafe(salesSql, ...params);
    const s = salesStats[0];

    // 2. Calculate Refunds from Returns
    let returnDateFilter = '';
    if (dto.from && dto.to) {
      returnDateFilter = `WHERE r.created_at >= $1::timestamp AND r.created_at <= $2::timestamp`;
    } else if (dto.from) {
      returnDateFilter = `WHERE r.created_at >= $1::timestamp`;
    }

    const returnsSql = `
      SELECT 
        COUNT(r.id)::int as "totalReturnsCount",
        COALESCE(SUM(r.refund_amount), 0)::numeric as "totalRefunds"
      FROM "${schemaName}".returns r
      ${returnDateFilter};
    `;
    const returnsStats: any[] = await this.prisma.$queryRawUnsafe(returnsSql, ...params);
    const r = returnsStats[0];

    // 3. Calculate Cost of Goods Sold (COGS)
    let cogsDateFilter = '';
    if (dto.from && dto.to) {
      cogsDateFilter = `WHERE s.created_at >= $1::timestamp AND s.created_at <= $2::timestamp`;
    } else if (dto.from) {
      cogsDateFilter = `WHERE s.created_at >= $1::timestamp`;
    }

    const cogsSql = `
      SELECT 
        COALESCE(SUM(
          COALESCE(
            si.total_cost,
            CASE 
              WHEN si.unit_type = 'PACK' THEN si.quantity * COALESCE(b.purchase_price_pack, 0)
              ELSE (si.quantity::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)
            END
          )
        ), 0)::numeric as "cogs"
      FROM "${schemaName}".sale_items si
      JOIN "${schemaName}".sales s ON si.sale_id = s.id
      JOIN "${schemaName}".inventory_items ii ON si.inventory_item_id = ii.id
      LEFT JOIN "${schemaName}".inventory_batches b ON si.inventory_batch_id = b.id
      ${cogsDateFilter};
    `;
    const cogsStats: any[] = await this.prisma.$queryRawUnsafe(cogsSql, ...params);
    const rawCogs = Number(cogsStats[0]?.cogs || 0);

    // Deduct cost of returned goods back to inventory
    const retCogsSql = `
      SELECT 
        COALESCE(SUM(
          COALESCE(
            r.total_cost,
            CASE 
              WHEN r.unit_type = 'PACK' THEN r.quantity * COALESCE(b.purchase_price_pack, 0)
              ELSE (r.quantity::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)
            END
          )
        ), 0)::numeric as "returnedCogs"
      FROM "${schemaName}".returns r
      JOIN "${schemaName}".inventory_items ii ON r.inventory_item_id = ii.id
      LEFT JOIN "${schemaName}".inventory_batches b ON b.id = COALESCE(
        r.inventory_batch_id,
        (SELECT inventory_batch_id FROM "${schemaName}".sale_items WHERE sale_id = r.sale_id AND inventory_item_id = r.inventory_item_id LIMIT 1)
      )
      ${returnDateFilter};
    `;
    const retCogsStats: any[] = await this.prisma.$queryRawUnsafe(retCogsSql, ...params);
    const returnedCogs = Number(retCogsStats[0]?.returnedCogs || 0);
    const cogs = Math.max(0, rawCogs - returnedCogs);

    const netRevenue = Number(s.netRevenue) - Number(r.totalRefunds);
    const grossProfit = netRevenue - cogs;
    const profitMarginPercent = netRevenue > 0
      ? Number(((grossProfit / netRevenue) * 100).toFixed(2))
      : 0;

    return {
      period: {
        from: dto.from || 'البداية',
        to: dto.to || 'الآن',
      },
      sales: {
        totalInvoices: s.totalInvoicesCount,
        grossSales: Number(s.grossSales),
        totalDiscounts: Number(s.totalDiscounts),
        netRevenue,
      },
      returns: {
        totalReturnsCount: r.totalReturnsCount,
        totalRefunds: Number(r.totalRefunds),
      },
      profitability: {
        costOfGoodsSold: cogs,
        grossProfit,
        profitMarginPercent,
      },
    };
  }

  /**
   * Top Selling Medicines by revenue and quantity
   */
  async getTopSellingMedicines(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();
    const limit = Math.min(Number(dto.limit || 10), 50);

    let dateFilter = '';
    const params: any[] = [limit];

    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `AND s.created_at >= $2::timestamp AND s.created_at <= $3::timestamp`;
    }

    const sql = `
      SELECT 
        m.id as "medicineId",
        m.trade_name as "tradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        COUNT(DISTINCT s.id)::int as "invoicesCount",
        SUM(CASE WHEN si.unit_type = 'PACK' THEN si.quantity ELSE 0 END)::int as "soldPacks",
        SUM(CASE WHEN si.unit_type = 'STRIP' THEN si.quantity ELSE 0 END)::int as "soldStrips",
        COALESCE(SUM(si.total_price), 0)::numeric as "totalRevenue"
      FROM "${schemaName}".sale_items si
      JOIN "${schemaName}".sales s ON si.sale_id = s.id
      JOIN "${schemaName}".inventory_items ii ON si.inventory_item_id = ii.id
      JOIN public.medicines m ON ii.medicine_id = m.id
      WHERE 1=1 ${dateFilter}
      GROUP BY m.id
      ORDER BY "totalRevenue" DESC
      LIMIT $1;
    `;

    const topItems: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);
    return topItems;
  }

  /**
   * Inventory Valuation (Current total stock value at cost and at retail selling price)
   */
  async getInventoryValuation() {
    const schemaName = this.tenantContext.getSchemaName();

    const sql = `
      SELECT 
        COUNT(DISTINCT i.id)::int as "totalDistinctItems",
        COALESCE(SUM(
          (b.quantity_units_remaining::numeric / GREATEST(i.units_per_pack, 1)) * b.purchase_price_pack
        ), 0)::numeric as "totalCostValue",
        COALESCE(SUM(
          (b.quantity_units_remaining::numeric / GREATEST(i.units_per_pack, 1)) * i.selling_price_pack
        ), 0)::numeric as "totalRetailValue"
      FROM "${schemaName}".inventory_items i
      JOIN "${schemaName}".inventory_batches b ON i.id = b.inventory_item_id
      WHERE b.quantity_units_remaining > 0;
    `;

    const stats: any[] = await this.prisma.$queryRawUnsafe(sql);
    const row = stats[0];

    const totalCostValue = Number(row.totalCostValue);
    const totalRetailValue = Number(row.totalRetailValue);
    const expectedProfit = totalRetailValue - totalCostValue;

    return {
      totalDistinctItems: row.totalDistinctItems,
      totalCostValue,
      totalRetailValue,
      expectedProfit,
    };
  }

  /**
   * Detailed Current Stocktake List
   */
  async getDetailedCurrentStocktake() {
    const schemaName = this.tenantContext.getSchemaName();

    const sql = `
      SELECT 
        ii.id as "inventoryItemId",
        ii.medicine_id as "medicineId",
        m.trade_name as "tradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.strength,
        m.barcode,
        ii.custom_name as "customName",
        ii.units_per_pack as "unitsPerPack",
        ii.selling_price_pack as "sellingPricePack",
        ii.selling_price_unit as "sellingPriceUnit",
        ii.min_alert_units as "minAlertUnits",
        COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
        FLOOR(COALESCE(SUM(b.quantity_units_remaining), 0)::numeric / GREATEST(ii.units_per_pack, 1))::int as "fullPacksRemaining",
        (COALESCE(SUM(b.quantity_units_remaining), 0) % GREATEST(ii.units_per_pack, 1))::int as "looseUnitsRemaining",
        COALESCE(AVG(b.purchase_price_pack), 0)::numeric as "avgCostPack",
        COALESCE(SUM((b.quantity_units_remaining::numeric / GREATEST(ii.units_per_pack, 1)) * b.purchase_price_pack), 0)::numeric as "totalCostValue",
        COALESCE(SUM((b.quantity_units_remaining::numeric / GREATEST(ii.units_per_pack, 1)) * ii.selling_price_pack), 0)::numeric as "totalRetailValue"
      FROM "${schemaName}".inventory_items ii
      JOIN public.medicines m ON ii.medicine_id = m.id
      LEFT JOIN "${schemaName}".inventory_batches b ON ii.id = b.inventory_item_id AND b.quantity_units_remaining > 0
      GROUP BY ii.id, m.id
      ORDER BY m.trade_name ASC;
    `;

    const items: any[] = await this.prisma.$queryRawUnsafe(sql);
    return items;
  }

  /**
   * Sold Medicines & Product-Level Profitability Analytics (Daily, Weekly, Monthly, Yearly)
   * Analyzes not just sales volume, but exact profit generated per product, profit margin %, and profitability rank
   */
  async getSoldMedicinesStocktake(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    let dateFilter = '';
    const params: any[] = [];

    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `WHERE s.created_at >= $1::timestamp AND s.created_at <= $2::timestamp`;
    } else if (dto.from) {
      params.push(`${dto.from} 00:00:00`);
      dateFilter = `WHERE s.created_at >= $1::timestamp`;
    }

    const sql = `
      SELECT 
        m.id as "medicineId",
        COALESCE(ii.custom_name, m.trade_name) as "tradeName",
        m.trade_name as "originalTradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.barcode,
        ii.units_per_pack as "unitsPerPack",
        ii.selling_price_pack as "sellingPricePack",
        COUNT(DISTINCT s.id)::int as "invoicesCount",
        SUM(CASE WHEN si.unit_type = 'PACK' THEN si.quantity ELSE 0 END)::int as "soldPacks",
        SUM(CASE WHEN si.unit_type = 'STRIP' THEN si.quantity ELSE 0 END)::int as "soldStrips",
        ROUND(
          SUM(
            CASE 
              WHEN si.unit_type = 'PACK' THEN si.quantity
              ELSE (si.quantity::numeric / GREATEST(ii.units_per_pack, 1))
            END
          ), 2
        )::numeric as "totalEquivalentPacks",
        ROUND(
          COALESCE(SUM(
            COALESCE(
              si.total_cost,
              CASE 
                WHEN si.unit_type = 'PACK' THEN si.quantity * COALESCE(b.purchase_price_pack, 0)
                ELSE (si.quantity::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)
              END
            )
          ), 0), 0
        )::numeric as "totalCost",
        ROUND(COALESCE(SUM(si.total_price), 0), 0)::numeric as "totalRevenue",
        ROUND(
          COALESCE(SUM(si.total_price), 0) - COALESCE(SUM(
            COALESCE(
              si.total_cost,
              CASE 
                WHEN si.unit_type = 'PACK' THEN si.quantity * COALESCE(b.purchase_price_pack, 0)
                ELSE (si.quantity::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)
              END
            )
          ), 0), 0
        )::numeric as "totalProfit"
      FROM "${schemaName}".sale_items si
      JOIN "${schemaName}".sales s ON si.sale_id = s.id
      JOIN "${schemaName}".inventory_items ii ON si.inventory_item_id = ii.id
      JOIN public.medicines m ON ii.medicine_id = m.id
      LEFT JOIN "${schemaName}".inventory_batches b ON si.inventory_batch_id = b.id
      ${dateFilter}
      GROUP BY m.id, ii.id
      ORDER BY "totalProfit" DESC;
    `;

    const rawItems: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);

    let sumRevenue = 0;
    let sumCost = 0;
    let sumProfit = 0;
    let sumSoldPacks = 0;
    let sumInvoices = 0;

    const items = rawItems.map((it) => {
      const revenue = Number(it.totalRevenue || 0);
      const cost = Number(it.totalCost || 0);
      const profit = Number(it.totalProfit || 0);
      const eqPacks = Number(it.totalEquivalentPacks || 0);

      sumRevenue += revenue;
      sumCost += cost;
      sumProfit += profit;
      sumSoldPacks += Number(it.soldPacks || 0);
      sumInvoices += Number(it.invoicesCount || 0);

      const marginPercent = revenue > 0 ? Number(((profit / revenue) * 100).toFixed(1)) : 0;
      const profitPerPack = eqPacks > 0 ? Math.round(profit / eqPacks) : 0;

      return {
        ...it,
        totalRevenue: revenue,
        totalCost: cost,
        totalProfit: profit,
        profitMarginPercent: marginPercent,
        profitPerPack,
      };
    });

    // Add contribution percentage
    const enrichedItems = items.map((it) => ({
      ...it,
      profitContributionPercent: sumProfit > 0 ? Number(((it.totalProfit / sumProfit) * 100).toFixed(1)) : 0,
    }));

    // Find top profit generator vs top volume medicine
    const sortedByProfit = [...enrichedItems].sort((a, b) => b.totalProfit - a.totalProfit);
    const sortedByVolume = [...enrichedItems].sort((a, b) => (b.soldPacks + b.soldStrips) - (a.soldPacks + a.soldStrips));

    return {
      period: {
        from: dto.from || 'البداية',
        to: dto.to || 'الآن',
      },
      summary: {
        totalRevenue: sumRevenue,
        totalCost: sumCost,
        totalProfit: sumProfit,
        averageProfitMargin: sumRevenue > 0 ? Number(((sumProfit / sumRevenue) * 100).toFixed(1)) : 0,
        totalSoldPacks: sumSoldPacks,
        totalInvoices: sumInvoices,
        distinctMedicinesCount: enrichedItems.length,
        topProfitMedicine: sortedByProfit[0] || null,
        topVolumeMedicine: sortedByVolume[0] || null,
      },
      items: enrichedItems,
    };
  }

  /**
   * Periodic Debts & Supplier Invoices Report
   */
  async getDebtsReport(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    let dateFilter = '';
    const params: any[] = [];

    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `AND p.created_at >= $1::timestamp AND p.created_at <= $2::timestamp`;
    } else if (dto.from) {
      params.push(`${dto.from} 00:00:00`);
      dateFilter = `AND p.created_at >= $1::timestamp`;
    }

    try {
      const sql = `
        SELECT 
          s.id as "supplierId",
          s.name as "supplierName",
          s.phone,
          COUNT(p.id)::int as "invoicesCount",
          COALESCE(SUM(p.net_total_amount), 0)::numeric as "totalPurchases",
          COALESCE(SUM(p.paid_amount), 0)::numeric as "totalPaid",
          COALESCE(SUM(p.remaining_amount), 0)::numeric as "remainingDebt"
        FROM "${schemaName}".suppliers s
        LEFT JOIN "${schemaName}".purchases p ON s.id = p.supplier_id ${dateFilter}
        GROUP BY s.id
        HAVING COUNT(p.id) > 0 OR COALESCE(SUM(p.remaining_amount), 0) > 0
        ORDER BY "remainingDebt" DESC;
      `;

      const suppliersReport: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);

      // Summary
      let totalPurchases = 0;
      let totalPaid = 0;
      let totalRemainingDebt = 0;
      for (const sup of suppliersReport) {
        totalPurchases += Number(sup.totalPurchases || 0);
        totalPaid += Number(sup.totalPaid || 0);
        totalRemainingDebt += Number(sup.remainingDebt || 0);
      }

      return {
        summary: {
          totalPurchases,
          totalPaid,
          totalRemainingDebt,
          totalSuppliers: suppliersReport.length,
        },
        suppliers: suppliersReport,
      };
    } catch (err: any) {
      this.logger.error(`Failed to generate debts report: ${err.message}`);
      return {
        summary: { totalPurchases: 0, totalPaid: 0, totalRemainingDebt: 0, totalSuppliers: 0 },
        suppliers: [],
      };
    }
  }

  /**
   * Comprehensive Net Profit (P&L) Report with Operating Expenses Breakdown
   */
  async getNetProfitReport(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    let dateFilter = '';
    const params: any[] = [];

    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `WHERE s.created_at >= $1::timestamp AND s.created_at <= $2::timestamp`;
    } else if (dto.from) {
      params.push(`${dto.from} 00:00:00`);
      dateFilter = `WHERE s.created_at >= $1::timestamp`;
    }

    // 1. Sales Revenue
    const salesSql = `
      SELECT 
        COUNT(s.id)::int as "totalInvoicesCount",
        COALESCE(SUM(s.subtotal), 0)::numeric as "grossSales",
        COALESCE(SUM(s.discount_amount), 0)::numeric as "totalDiscounts",
        COALESCE(SUM(s.total_amount), 0)::numeric as "netRevenue"
      FROM "${schemaName}".sales s
      ${dateFilter};
    `;
    const salesStats: any[] = await this.prisma.$queryRawUnsafe(salesSql, ...params);
    const s = salesStats[0] || { totalInvoicesCount: 0, grossSales: 0, totalDiscounts: 0, netRevenue: 0 };

    // 2. Returns
    let returnDateFilter = '';
    if (dto.from && dto.to) {
      returnDateFilter = `WHERE r.created_at >= $1::timestamp AND r.created_at <= $2::timestamp`;
    } else if (dto.from) {
      returnDateFilter = `WHERE r.created_at >= $1::timestamp`;
    }
    const returnsSql = `
      SELECT 
        COUNT(r.id)::int as "totalReturnsCount",
        COALESCE(SUM(r.refund_amount), 0)::numeric as "totalRefunds"
      FROM "${schemaName}".returns r
      ${returnDateFilter};
    `;
    const returnsStats: any[] = await this.prisma.$queryRawUnsafe(returnsSql, ...params);
    const r = returnsStats[0] || { totalReturnsCount: 0, totalRefunds: 0 };

    // 3. COGS
    let cogsDateFilter = '';
    if (dto.from && dto.to) {
      cogsDateFilter = `WHERE s.created_at >= $1::timestamp AND s.created_at <= $2::timestamp`;
    } else if (dto.from) {
      cogsDateFilter = `WHERE s.created_at >= $1::timestamp`;
    }
    const cogsSql = `
      SELECT 
        COALESCE(SUM(
          COALESCE(
            si.total_cost,
            CASE 
              WHEN si.unit_type = 'PACK' THEN si.quantity * COALESCE(b.purchase_price_pack, 0)
              ELSE (si.quantity::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)
            END
          )
        ), 0)::numeric as "cogs"
      FROM "${schemaName}".sale_items si
      JOIN "${schemaName}".sales s ON si.sale_id = s.id
      JOIN "${schemaName}".inventory_items ii ON si.inventory_item_id = ii.id
      LEFT JOIN "${schemaName}".inventory_batches b ON si.inventory_batch_id = b.id
      ${cogsDateFilter};
    `;
    const cogsStats: any[] = await this.prisma.$queryRawUnsafe(cogsSql, ...params);
    const rawCogs = Number(cogsStats[0]?.cogs || 0);

    // Deduct cost of returned goods back to inventory
    const retCogsSql = `
      SELECT 
        COALESCE(SUM(
          COALESCE(
            r.total_cost,
            CASE 
              WHEN r.unit_type = 'PACK' THEN r.quantity * COALESCE(b.purchase_price_pack, 0)
              ELSE (r.quantity::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)
            END
          )
        ), 0)::numeric as "returnedCogs"
      FROM "${schemaName}".returns r
      JOIN "${schemaName}".inventory_items ii ON r.inventory_item_id = ii.id
      LEFT JOIN "${schemaName}".inventory_batches b ON b.id = COALESCE(
        r.inventory_batch_id,
        (SELECT inventory_batch_id FROM "${schemaName}".sale_items WHERE sale_id = r.sale_id AND inventory_item_id = r.inventory_item_id LIMIT 1)
      )
      ${returnDateFilter};
    `;
    const retCogsStats: any[] = await this.prisma.$queryRawUnsafe(retCogsSql, ...params);
    const returnedCogs = Number(retCogsStats[0]?.returnedCogs || 0);
    const cogs = Math.max(0, rawCogs - returnedCogs);

    // 4. Operating Expenses
    let expDateFilter = '';
    const expParams: any[] = [];
    if (dto.from && dto.to) {
      expParams.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      expDateFilter = `WHERE expense_date >= $1::timestamp AND expense_date <= $2::timestamp`;
    } else if (dto.from) {
      expParams.push(`${dto.from} 00:00:00`);
      expDateFilter = `WHERE expense_date >= $1::timestamp`;
    }

    let totalExpenses = 0;
    let expensesByCategory: Record<string, number> = {};

    try {
      const expensesQuery = `
        SELECT category, SUM(amount)::numeric as total
        FROM "${schemaName}".expenses
        ${expDateFilter}
        GROUP BY category;
      `;
      const expRows: any[] = await this.prisma.$queryRawUnsafe(expensesQuery, ...expParams);
      for (const row of expRows) {
        const amt = Number(row.total || 0);
        expensesByCategory[row.category] = amt;
        totalExpenses += amt;
      }
    } catch {
      // If expenses table not yet populated
    }

    const netSales = Number(s.netRevenue) - Number(r.totalRefunds);
    const grossProfit = netSales - cogs;
    const netProfit = grossProfit - totalExpenses;
    const netProfitMarginPercent = netSales > 0 ? Number(((netProfit / netSales) * 100).toFixed(2)) : 0;

    return {
      period: {
        from: dto.from || 'البداية',
        to: dto.to || 'الآن',
      },
      revenue: {
        grossSales: Number(s.grossSales),
        totalDiscounts: Number(s.totalDiscounts),
        totalRefunds: Number(r.totalRefunds),
        netSales,
      },
      cogs,
      grossProfit,
      expenses: {
        total: totalExpenses,
        byCategory: expensesByCategory,
      },
      netProfit,
      netProfitMarginPercent,
    };
  }

  /**
   * Dead Stock (Stagnant Inventory & Frozen Capital Discovery)
   * Discovers medicines that haven't been sold for X days (e.g. 60, 90, 180 days or never sold),
   * calculates frozen capital, links expiry dates and supplier contact info for return.
   */
  async getDeadStockReport(thresholdDays: number = 90) {
    const schemaName = this.tenantContext.getSchemaName();
    const days = Number(thresholdDays) || 90;

    let timeFilter = `OR MAX(s.created_at) < (CURRENT_TIMESTAMP - INTERVAL '${days} days')`;
    if (days >= 9999) {
      // Never sold filter
      timeFilter = '';
    }

    const sql = `
      SELECT 
        ii.id as "inventoryItemId",
        COALESCE(ii.custom_name, m.trade_name) as "tradeName",
        m.trade_name as "originalTradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.barcode,
        ii.units_per_pack as "unitsPerPack",
        ii.selling_price_pack as "sellingPricePack",
        COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
        FLOOR(COALESCE(SUM(b.quantity_units_remaining), 0)::numeric / GREATEST(ii.units_per_pack, 1))::int as "packsRemaining",
        (COALESCE(SUM(b.quantity_units_remaining), 0) % GREATEST(ii.units_per_pack, 1))::int as "stripsRemaining",
        ROUND(COALESCE(AVG(b.purchase_price_pack), 0), 0)::numeric as "avgCostPack",
        ROUND(
          COALESCE(
            SUM((b.quantity_units_remaining::numeric / GREATEST(ii.units_per_pack, 1)) * COALESCE(b.purchase_price_pack, 0)),
            0
          ), 0
        )::numeric as "stagnantCapital",
        MAX(s.created_at) as "lastSoldAt",
        MIN(b.expiry_date) as "earliestExpiry",
        TO_CHAR(MIN(b.expiry_date), 'MM/YYYY') as "expiryFormatted",
        (MIN(b.expiry_date) - CURRENT_DATE)::int as "daysUntilExpiry",
        (
          SELECT b_sub.batch_number
          FROM "${schemaName}".inventory_batches b_sub
          WHERE b_sub.inventory_item_id = ii.id AND b_sub.quantity_units_remaining > 0
          ORDER BY b_sub.expiry_date ASC LIMIT 1
        ) as "oldestBatchNumber",
        (
          SELECT s_sub.name 
          FROM "${schemaName}".inventory_batches b_sub
          LEFT JOIN "${schemaName}".suppliers s_sub ON b_sub.supplier_id = s_sub.id
          WHERE b_sub.inventory_item_id = ii.id AND b_sub.quantity_units_remaining > 0
          ORDER BY b_sub.created_at DESC LIMIT 1
        ) as "supplierName",
        (
          SELECT s_sub.phone 
          FROM "${schemaName}".inventory_batches b_sub
          LEFT JOIN "${schemaName}".suppliers s_sub ON b_sub.supplier_id = s_sub.id
          WHERE b_sub.inventory_item_id = ii.id AND b_sub.quantity_units_remaining > 0
          ORDER BY b_sub.created_at DESC LIMIT 1
        ) as "supplierPhone"
      FROM "${schemaName}".inventory_items ii
      JOIN public.medicines m ON ii.medicine_id = m.id
      LEFT JOIN "${schemaName}".inventory_batches b ON ii.id = b.inventory_item_id AND b.quantity_units_remaining > 0
      LEFT JOIN "${schemaName}".sale_items si ON ii.id = si.inventory_item_id
      LEFT JOIN "${schemaName}".sales s ON si.sale_id = s.id
      GROUP BY ii.id, m.id
      HAVING 
        COALESCE(SUM(b.quantity_units_remaining), 0) > 0
        AND (
          MAX(s.created_at) IS NULL 
          ${timeFilter}
        )
      ORDER BY "stagnantCapital" DESC;
    `;

    try {
      const rawItems: any[] = await this.prisma.$queryRawUnsafe(sql);
      let totalStagnantCapital = 0;
      let stagnantCapitalNearExpiry = 0;
      let totalPacksCount = 0;
      const supplierTally: Record<string, { name: string; frozenCapital: number; itemsCount: number }> = {};

      const items = rawItems.map((it) => {
        const capital = Number(it.stagnantCapital || 0);
        const daysExpiry = it.daysUntilExpiry !== null ? Number(it.daysUntilExpiry) : 999;
        const isNearExpiry = daysExpiry <= 90;

        totalStagnantCapital += capital;
        totalPacksCount += Number(it.packsRemaining || 0);

        if (isNearExpiry) {
          stagnantCapitalNearExpiry += capital;
        }

        const suppName = it.supplierName || 'مذخر غير محدد';
        if (!supplierTally[suppName]) {
          supplierTally[suppName] = { name: suppName, frozenCapital: 0, itemsCount: 0 };
        }
        supplierTally[suppName].frozenCapital += capital;
        supplierTally[suppName].itemsCount += 1;

        let daysSinceLastSale: number | null = null;
        if (it.lastSoldAt) {
          const diffMs = Date.now() - new Date(it.lastSoldAt).getTime();
          daysSinceLastSale = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }

        return {
          ...it,
          stagnantCapital: capital,
          daysUntilExpiry: daysExpiry,
          isNearExpiry,
          daysSinceLastSale,
        };
      });

      const topSuppliers = Object.values(supplierTally).sort((a, b) => b.frozenCapital - a.frozenCapital);

      return {
        thresholdDays: days,
        summary: {
          totalStagnantItemsCount: items.length,
          totalStagnantCapital,
          stagnantCapitalNearExpiry,
          totalPacksCount,
          topSuppliers,
        },
        items,
      };
    } catch (err: any) {
      this.logger.error(`Error calculating dead stock report: ${err.message}`);
      return {
        thresholdDays: days,
        summary: {
          totalStagnantItemsCount: 0,
          totalStagnantCapital: 0,
          stagnantCapitalNearExpiry: 0,
          totalPacksCount: 0,
          topSuppliers: [],
        },
        items: [],
      };
    }
  }

  /**
   * Smart Stock Dynamic Sales Velocity & Depletion Prediction Report
   * Predicts days until stockout based on real 30-day velocity and suggests reorder quantities
   */
  async getSmartStockPredictionReport() {
    const schemaName = this.tenantContext.getSchemaName();

    const sql = `
      SELECT 
        ii.id as "inventoryItemId",
        m.trade_name as "tradeName",
        m.scientific_name as "scientificName",
        m.barcode,
        ii.units_per_pack as "unitsPerPack",
        ii.selling_price_pack as "sellingPricePack",
        COALESCE(SUM(b.quantity_units_remaining), 0)::int as "totalUnitsRemaining",
        COALESCE((
          SELECT SUM(
            CASE 
              WHEN si.unit_type = 'PACK' THEN si.quantity
              ELSE si.quantity::numeric / GREATEST(ii.units_per_pack, 1)
            END
          )
          FROM "${schemaName}".sale_items si
          JOIN "${schemaName}".sales s ON si.sale_id = s.id
          WHERE si.inventory_item_id = ii.id
            AND s.created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
        ), 0)::numeric as "soldPacksLast30Days"
      FROM "${schemaName}".inventory_items ii
      JOIN public.medicines m ON ii.medicine_id = m.id
      LEFT JOIN "${schemaName}".inventory_batches b ON ii.id = b.inventory_item_id
      GROUP BY ii.id, m.trade_name, m.scientific_name, m.barcode, ii.units_per_pack, ii.selling_price_pack
      ORDER BY "soldPacksLast30Days" DESC;
    `;

    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(sql);

      let criticalCount = 0;
      let runningLowCount = 0;
      let outOfStockCount = 0;

      const items = rows.map((r) => {
        const unitsPerPack = Math.max(1, Number(r.unitsPerPack || 1));
        const totalUnitsRemaining = Number(r.totalUnitsRemaining || 0);
        const currentStockPacks = Number((totalUnitsRemaining / unitsPerPack).toFixed(1));
        const soldPacksLast30Days = Number(r.soldPacksLast30Days || 0);
        const dailySalesVelocity = Number((soldPacksLast30Days / 30).toFixed(2));

        let daysLeft = 999;
        let status: 'OUT_OF_STOCK' | 'CRITICAL' | 'RUNNING_LOW' | 'HEALTHY' | 'STAGNANT' = 'HEALTHY';

        if (currentStockPacks <= 0) {
          daysLeft = 0;
          status = 'OUT_OF_STOCK';
          outOfStockCount++;
        } else if (dailySalesVelocity <= 0) {
          daysLeft = 999;
          status = 'STAGNANT';
        } else {
          daysLeft = Number((currentStockPacks / dailySalesVelocity).toFixed(1));
          if (daysLeft <= 3.5) {
            status = 'CRITICAL';
            criticalCount++;
          } else if (daysLeft <= 10) {
            status = 'RUNNING_LOW';
            runningLowCount++;
          } else {
            status = 'HEALTHY';
          }
        }

        const suggestedReorderPacks = dailySalesVelocity > 0
          ? Math.max(0, Math.ceil(dailySalesVelocity * 25 - currentStockPacks))
          : (currentStockPacks <= 0 ? 20 : 0);

        return {
          inventoryItemId: r.inventoryItemId,
          tradeName: r.tradeName,
          scientificName: r.scientificName,
          barcode: r.barcode,
          unitsPerPack,
          sellingPricePack: Number(r.sellingPricePack || 0),
          totalUnitsRemaining,
          currentStockPacks,
          soldPacksLast30Days,
          dailySalesVelocity,
          daysLeft,
          status,
          suggestedReorderPacks,
        };
      });

      // Sort with highest risk first: Out of stock -> Critical -> Running low -> Healthy
      const statusOrder: Record<string, number> = {
        CRITICAL: 1,
        RUNNING_LOW: 2,
        OUT_OF_STOCK: 3,
        HEALTHY: 4,
        STAGNANT: 5,
      };

      items.sort((a, b) => {
        const orderDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
        if (orderDiff !== 0) return orderDiff;
        return a.daysLeft - b.daysLeft;
      });

      return {
        summary: {
          totalTrackedMedicines: items.length,
          criticalCount,
          runningLowCount,
          outOfStockCount,
          atRiskTotal: criticalCount + runningLowCount + outOfStockCount,
        },
        items,
      };
    } catch (err: any) {
      this.logger.error(`Error calculating smart stock prediction: ${err.message}`);
      return {
        summary: { totalTrackedMedicines: 0, criticalCount: 0, runningLowCount: 0, outOfStockCount: 0, atRiskTotal: 0 },
        items: [],
      };
    }
  }

  /**
   * Cashier Shifts Handover & Audit Report
   */
  async getShiftsAuditReport(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    let dateFilter = '';
    const params: any[] = [];
    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `WHERE (closed_at >= $1::timestamp AND closed_at <= $2::timestamp) OR (closed_at IS NULL AND opened_at >= $1::timestamp)`;
    } else if (dto.from) {
      params.push(`${dto.from} 00:00:00`);
      dateFilter = `WHERE (closed_at >= $1::timestamp) OR (closed_at IS NULL AND opened_at >= $1::timestamp)`;
    }

    const shiftsSql = `
      SELECT 
        id,
        user_id as "userId",
        user_name as "userName",
        opened_at as "openedAt",
        closed_at as "closedAt",
        COALESCE(opening_cash, 0)::numeric as "openingCash",
        COALESCE(expected_cash, 0)::numeric as "expectedCash",
        COALESCE(actual_cash, 0)::numeric as "actualCash",
        COALESCE(cash_difference, 0)::numeric as "cashDifference",
        COALESCE(total_sales_count, 0)::int as "totalSalesCount",
        COALESCE(total_sales_amount, 0)::numeric as "totalSalesAmount",
        notes,
        status
      FROM "${schemaName}".shift_logs
      ${dateFilter}
      ORDER BY closed_at DESC NULLS FIRST, opened_at DESC;
    `;

    let shifts: any[] = [];
    try {
      shifts = await this.prisma.$queryRawUnsafe(shiftsSql, ...params);
    } catch {
      shifts = [];
    }

    const totalShifts = shifts.length;
    let totalSalesRevenue = 0;
    let totalExpectedCash = 0;
    let totalActualCash = 0;
    let totalCashDifference = 0;
    let balancedShiftsCount = 0;
    let shortageShiftsCount = 0;
    let surplusShiftsCount = 0;

    const staffMap: Record<string, {
      userName: string;
      shiftsCount: number;
      totalSalesAmount: number;
      totalSalesCount: number;
      totalCashDifference: number;
      shortagesCount: number;
      surplusesCount: number;
    }> = {};

    for (const sh of shifts) {
      const salesAmt = Number(sh.totalSalesAmount || 0);
      const expCash = Number(sh.expectedCash || 0);
      const actCash = Number(sh.actualCash || 0);
      const diff = Number(sh.cashDifference || 0);

      totalSalesRevenue += salesAmt;
      totalExpectedCash += expCash;
      totalActualCash += actCash;
      totalCashDifference += diff;

      if (diff === 0) {
        balancedShiftsCount++;
      } else if (diff < 0) {
        shortageShiftsCount++;
      } else {
        surplusShiftsCount++;
      }

      const userKey = sh.userName || 'غير محدد';
      if (!staffMap[userKey]) {
        staffMap[userKey] = {
          userName: userKey,
          shiftsCount: 0,
          totalSalesAmount: 0,
          totalSalesCount: 0,
          totalCashDifference: 0,
          shortagesCount: 0,
          surplusesCount: 0,
        };
      }

      staffMap[userKey].shiftsCount++;
      staffMap[userKey].totalSalesAmount += salesAmt;
      staffMap[userKey].totalSalesCount += Number(sh.totalSalesCount || 0);
      staffMap[userKey].totalCashDifference += diff;
      if (diff < 0) staffMap[userKey].shortagesCount++;
      if (diff > 0) staffMap[userKey].surplusesCount++;
    }

    const staffPerformance = Object.values(staffMap).sort(
      (a, b) => b.totalSalesAmount - a.totalSalesAmount,
    );

    return {
      summary: {
        totalShifts,
        totalSalesRevenue,
        totalExpectedCash,
        totalActualCash,
        totalCashDifference,
        balancedShiftsCount,
        shortageShiftsCount,
        surplusShiftsCount,
      },
      staffPerformance,
      shifts,
    };
  }

  /**
   * Returns & Spoilage / Damaged Stock Audit Report
   */
  async getReturnsAuditReport(dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    let dateFilter = '';
    const params: any[] = [];
    if (dto.from && dto.to) {
      params.push(`${dto.from} 00:00:00`, `${dto.to} 23:59:59`);
      dateFilter = `WHERE r.created_at >= $1::timestamp AND r.created_at <= $2::timestamp`;
    } else if (dto.from) {
      params.push(`${dto.from} 00:00:00`);
      dateFilter = `WHERE r.created_at >= $1::timestamp`;
    }

    const returnsSql = `
      SELECT 
        r.id,
        r.sale_id as "saleId",
        r.inventory_item_id as "inventoryItemId",
        COALESCE(r.trade_name, m.trade_name, 'دواء') as "tradeName",
        m.scientific_name as "scientificName",
        r.unit_type as "unitType",
        r.quantity,
        r.refund_amount as "refundAmount",
        COALESCE(r.item_condition, 'RESALEABLE') as "itemCondition",
        COALESCE(r.payment_method, 'CASH') as "paymentMethod",
        r.user_name as "cashierName",
        r.reason,
        r.notes,
        r.created_at as "createdAt"
      FROM "${schemaName}".returns r
      LEFT JOIN "${schemaName}".inventory_items ii ON r.inventory_item_id = ii.id
      LEFT JOIN public.medicines m ON ii.medicine_id = m.id
      ${dateFilter}
      ORDER BY r.created_at DESC;
    `;

    let returnsList: any[] = [];
    try {
      returnsList = await this.prisma.$queryRawUnsafe(returnsSql, ...params);
    } catch {
      returnsList = [];
    }

    let totalRefundAmount = 0;
    let resaleableCount = 0;
    let resaleableRefund = 0;
    let damagedCount = 0;
    let damagedRefund = 0;

    const paymentMethodsSummary = {
      CASH: 0,
      ZAIN_CASH: 0,
      QI_CARD: 0,
    };

    const reasonsMap: Record<string, { reason: string; count: number; totalRefund: number }> = {};

    for (const item of returnsList) {
      const amount = Number(item.refundAmount || 0);
      totalRefundAmount += amount;

      if (item.itemCondition === 'DAMAGED') {
        damagedCount++;
        damagedRefund += amount;
      } else {
        resaleableCount++;
        resaleableRefund += amount;
      }

      const method = (item.paymentMethod || 'CASH') as 'CASH' | 'ZAIN_CASH' | 'QI_CARD';
      if (paymentMethodsSummary[method] !== undefined) {
        paymentMethodsSummary[method] += amount;
      } else {
        paymentMethodsSummary.CASH += amount;
      }

      const rsn = (item.reason || 'إرجاع عام').trim();
      if (!reasonsMap[rsn]) {
        reasonsMap[rsn] = { reason: rsn, count: 0, totalRefund: 0 };
      }
      reasonsMap[rsn].count++;
      reasonsMap[rsn].totalRefund += amount;
    }

    const topReasons = Object.values(reasonsMap).sort((a, b) => b.count - a.count);

    return {
      summary: {
        totalReturnsCount: returnsList.length,
        totalRefundAmount,
        resaleableCount,
        resaleableRefund,
        damagedCount,
        damagedRefund,
      },
      paymentMethods: paymentMethodsSummary,
      topReasons,
      items: returnsList,
    };
  }

  /**
   * Detailed Medicine Stock Kardex (Full Chronological Movement & Audit Trail)
   */
  async getMedicineKardex(inventoryItemId: string, dto: DateRangeDto) {
    const schemaName = this.tenantContext.getSchemaName();

    // 1. Fetch Medicine and Inventory Details
    const itemRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        ii.id,
        ii.medicine_id as "medicineId",
        COALESCE(ii.custom_name, m.trade_name) as "tradeName",
        m.scientific_name as "scientificName",
        m.dosage_form as "dosageForm",
        m.strength,
        ii.units_per_pack as "unitsPerPack",
        ii.selling_price_pack as "sellingPricePack",
        ii.selling_price_unit as "sellingPriceUnit"
      FROM "${schemaName}".inventory_items ii
      LEFT JOIN public.medicines m ON ii.medicine_id = m.id
      WHERE ii.id = $1::uuid
      LIMIT 1;
    `, inventoryItemId);

    if (itemRows.length === 0) {
      return { medicine: null, currentStockUnits: 0, movements: [] };
    }

    const medicine = itemRows[0];
    const unitsPerPack = Number(medicine.unitsPerPack) || 1;

    // 2. Fetch Active Batches & Current Stock
    const batchRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        id, batch_number as "batchNumber", expiry_date as "expiryDate",
        quantity_units_remaining as "remainingUnits",
        purchase_price_pack as "purchasePricePack",
        selling_price_pack as "sellingPricePack"
      FROM "${schemaName}".inventory_batches
      WHERE inventory_item_id = $1::uuid
      ORDER BY expiry_date ASC;
    `, inventoryItemId);

    const currentStockUnits = batchRows.reduce((sum, b) => sum + Number(b.remainingUnits || 0), 0);

    // 3. Gather Chronological Movements:
    // A. Purchases (Inflow)
    let purchasesRows: any[] = [];
    try {
      purchasesRows = await this.prisma.$queryRawUnsafe(`
        SELECT 
          pi.id,
          COALESCE(p.created_at, NOW()) as "date",
          'PURCHASE' as "type",
          pi.quantity_packs as "packs",
          COALESCE(pi.bonus_packs, 0) as "bonusPacks",
          (pi.quantity_packs + COALESCE(pi.bonus_packs, 0)) * $2 as "units",
          pi.purchase_price_pack as "unitPrice",
          pi.net_cost_pack as "netCost",
          pi.batch_number as "batchNumber",
          pi.expiry_date as "expiryDate",
          s.name as "supplierName",
          p.invoice_number as "docNumber"
        FROM "${schemaName}".purchase_items pi
        LEFT JOIN "${schemaName}".purchases p ON pi.purchase_id = p.id
        LEFT JOIN "${schemaName}".suppliers s ON p.supplier_id = s.id
        WHERE pi.inventory_item_id = $1::uuid;
      `, inventoryItemId, unitsPerPack);
    } catch {
      purchasesRows = [];
    }

    // B. Sales (Outflow)
    let salesRows: any[] = [];
    try {
      salesRows = await this.prisma.$queryRawUnsafe(`
        SELECT 
          si.id,
          s.created_at as "date",
          'SALE' as "type",
          si.quantity,
          si.unit_type as "unitType",
          CASE 
            WHEN si.unit_type = 'PACK' THEN si.quantity * $2 
            ELSE si.quantity 
          END as "units",
          si.unit_price as "unitPrice",
          si.total_price as "totalPrice",
          s.invoice_number as "docNumber",
          b.batch_number as "batchNumber",
          u.name as "cashierName"
        FROM "${schemaName}".sale_items si
        JOIN "${schemaName}".sales s ON si.sale_id = s.id
        LEFT JOIN "${schemaName}".users u ON s.user_id = u.id
        LEFT JOIN "${schemaName}".inventory_batches b ON si.inventory_batch_id = b.id
        WHERE si.inventory_item_id = $1::uuid;
      `, inventoryItemId, unitsPerPack);
    } catch {
      salesRows = [];
    }

    // C. Returns
    let returnsRows: any[] = [];
    try {
      returnsRows = await this.prisma.$queryRawUnsafe(`
        SELECT 
          r.id,
          r.created_at as "date",
          'RETURN' as "type",
          r.quantity,
          r.unit_type as "unitType",
          CASE 
            WHEN r.unit_type = 'PACK' THEN r.quantity * $2 
            ELSE r.quantity 
          END as "units",
          r.refund_amount as "refundAmount",
          COALESCE(r.item_condition, 'RESALEABLE') as "condition",
          r.user_name as "cashierName",
          r.reason,
          r.notes
        FROM "${schemaName}".returns r
        WHERE r.inventory_item_id = $1::uuid;
      `, inventoryItemId, unitsPerPack);
    } catch {
      returnsRows = [];
    }

    // Merge and sort ascending by date
    const allEvents: any[] = [];

    for (const p of purchasesRows) {
      allEvents.push({
        id: p.id,
        date: p.date,
        type: 'PURCHASE',
        label: `شراء من مذخر (${p.supplierName || 'مجهول'})`,
        docNumber: p.docNumber,
        batchNumber: p.batchNumber,
        expiryDate: p.expiryDate,
        inUnits: Number(p.units || 0),
        outUnits: 0,
        price: Number(p.purchasePricePack || p.unitPrice || 0),
        extra: `كمية: ${p.packs} علبة + ${p.bonusPacks} بونص`,
      });
    }

    for (const s of salesRows) {
      allEvents.push({
        id: s.id,
        date: s.date,
        type: 'SALE',
        label: `بيع نقدي (فاتورة: ${s.docNumber || '—'})`,
        docNumber: s.docNumber,
        batchNumber: s.batchNumber,
        inUnits: 0,
        outUnits: Number(s.units || 0),
        price: Number(s.unitPrice || 0),
        cashier: s.cashierName,
        extra: `${s.quantity} ${s.unitType === 'PACK' ? 'علبة' : 'شريط'}`,
      });
    }

    for (const r of returnsRows) {
      const isResaleable = r.condition === 'RESALEABLE';
      allEvents.push({
        id: r.id,
        date: r.date,
        type: 'RETURN',
        label: isResaleable ? 'إرجاع دواء سليم (أُعيد للرف)' : 'إرجاع دواء تالف (معزول)',
        inUnits: isResaleable ? Number(r.units || 0) : 0,
        outUnits: 0,
        price: Number(r.refundAmount || 0),
        condition: r.condition,
        cashier: r.cashierName,
        extra: `${r.quantity} ${r.unitType === 'PACK' ? 'علبة' : 'شريط'} (${r.reason || 'إرجاع'})`,
      });
    }

    allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Compute cumulative stock balance progression from start
    let runningUnits = 0;
    const movementsWithBalance = allEvents.map((ev) => {
      runningUnits += ev.inUnits - ev.outUnits;
      return {
        ...ev,
        runningBalanceUnits: runningUnits,
        runningBalancePacks: Math.floor(runningUnits / unitsPerPack),
        runningBalanceStrips: runningUnits % unitsPerPack,
      };
    });

    // Return in reverse chronological order (newest on top) for display
    movementsWithBalance.reverse();

    return {
      medicine: {
        ...medicine,
        currentStockPacks: Math.floor(currentStockUnits / unitsPerPack),
        currentStockStrips: currentStockUnits % unitsPerPack,
        currentStockUnits,
      },
      batches: batchRows,
      movements: movementsWithBalance,
    };
  }
}

