import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from './reports.service';
import { DateRangeDto } from './dto/date-range.dto';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
@Roles('OWNER')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial')
  async getFinancialReport(@Query() query: DateRangeDto) {
    return this.reportsService.getFinancialReport(query);
  }

  @Get('top-selling')
  async getTopSellingMedicines(@Query() query: DateRangeDto) {
    return this.reportsService.getTopSellingMedicines(query);
  }

  @Get('inventory-valuation')
  async getInventoryValuation() {
    return this.reportsService.getInventoryValuation();
  }

  @Get('stocktake/current')
  async getDetailedCurrentStocktake() {
    return this.reportsService.getDetailedCurrentStocktake();
  }

  @Get('stocktake/sold')
  async getSoldMedicinesStocktake(@Query() query: DateRangeDto) {
    return this.reportsService.getSoldMedicinesStocktake(query);
  }

  @Get('debts/summary')
  async getDebtsReport(@Query() query: DateRangeDto) {
    return this.reportsService.getDebtsReport(query);
  }

  @Get('net-profit')
  async getNetProfitReport(@Query() query: DateRangeDto) {
    return this.reportsService.getNetProfitReport(query);
  }

  @Get('dead-stock')
  async getDeadStockReport(@Query('days') days?: number) {
    return this.reportsService.getDeadStockReport(days ? Number(days) : 60);
  }

  @Get('smart-stock-forecast')
  async getSmartStockPredictionReport() {
    return this.reportsService.getSmartStockPredictionReport();
  }

  @Get('shifts-audit')
  async getShiftsAuditReport(@Query() query: DateRangeDto) {
    return this.reportsService.getShiftsAuditReport(query);
  }

  @Get('returns-audit')
  async getReturnsAuditReport(@Query() query: DateRangeDto) {
    return this.reportsService.getReturnsAuditReport(query);
  }

  @Get('medicine-kardex/:inventoryItemId')
  async getMedicineKardex(
    @Param('inventoryItemId') inventoryItemId: string,
    @Query() query: DateRangeDto,
  ) {
    return this.reportsService.getMedicineKardex(inventoryItemId, query);
  }
}
