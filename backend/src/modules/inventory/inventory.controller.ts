import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InventoryService } from './inventory.service';
import {
  BulkStockEntryDto,
  UpdateItemPriceDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  RecordSupplierPaymentDto,
} from './dto/bulk-stock-entry.dto';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  async getPharmacyInventory(@Query() query: { search?: string; supplierId?: string }) {
    return this.inventoryService.getPharmacyInventory(query);
  }

  @Get('batches/trace/:batchNumber')
  @Roles('OWNER')
  async getBatchTraceability(@Param('batchNumber') batchNumber: string) {
    return this.inventoryService.getBatchTraceability(batchNumber);
  }

  @Post('batches/recall')
  @Roles('OWNER')
  async setBatchRecall(
    @Body() body: { batchNumber: string; isRecalled: boolean },
    @CurrentUser() user: any,
  ) {
    return this.inventoryService.setBatchRecall(body.batchNumber, body.isRecalled, user);
  }

  @Get('summary')
  async getInventorySummary() {
    return this.inventoryService.getInventorySummary();
  }

  // Suppliers & Debts Endpoints
  @Get('suppliers/summary')
  @Roles('OWNER')
  async getSuppliersSummary() {
    return this.inventoryService.getSuppliersSummary();
  }

  @Get('suppliers')
  async getSuppliers() {
    return this.inventoryService.getSuppliers();
  }

  @Post('suppliers')
  @Roles('OWNER')
  async createSupplier(@Body() dto: CreateSupplierDto) {
    return this.inventoryService.createSupplier(dto);
  }

  @Patch('suppliers/:id')
  @Roles('OWNER')
  async updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.inventoryService.updateSupplier(id, dto);
  }

  @Get('suppliers/:id/ledger')
  @Roles('OWNER')
  async getSupplierLedger(@Param('id') id: string) {
    return this.inventoryService.getSupplierLedger(id);
  }

  @Post('suppliers/:id/pay')
  @Roles('OWNER')
  async recordSupplierPayment(
    @Param('id') id: string,
    @Body() dto: RecordSupplierPaymentDto,
  ) {
    return this.inventoryService.recordSupplierPayment(id, dto);
  }

  @Get('low-stock')
  async getLowStockAlerts() {
    return this.inventoryService.getLowStockAlerts();
  }

  @Get('expiring-soon')
  async getExpiringSoonAlerts(@Query('months') months?: number) {
    return this.inventoryService.getExpiringSoonAlerts(months ? Number(months) : 3);
  }

  @Get('smart-expiry-summary')
  @Roles('OWNER')
  async getSmartExpirySummary(
    @Query('search') search?: string,
    @Query('supplierId') supplierId?: string,
    @Query('months') months?: string,
    @Query('allBatches') allBatches?: string,
    @Query('tier') tier?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.inventoryService.getSmartExpirySummary({
      search,
      supplierId,
      months: months ? Number(months) : undefined,
      allBatches: allBatches === 'true' || allBatches === '1',
      tier,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
    });
  }

  @Get('shortages-by-supplier')
  async getShortagesBySupplier(
    @Query('supplierId') supplierId?: string,
    @Query('severity') severity?: string,
  ) {
    return this.inventoryService.getShortagesBySupplier({ supplierId, severity });
  }

  @Post('batches/:batchId/return-to-supplier')
  @Roles('OWNER')
  async returnBatchToSupplier(
    @Param('batchId') batchId: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.inventoryService.returnBatchToSupplier(batchId, dto, user);
  }

  @Get('medicine-last-history/:medicineId')
  async getMedicineLastHistory(@Param('medicineId') medicineId: string) {
    return this.inventoryService.getMedicineLastHistory(medicineId);
  }

  @Get(':id/batches')
  async getItemBatches(@Param('id') id: string) {
    return this.inventoryService.getItemBatches(id);
  }

  @Post('bulk-entry')
  @Roles('OWNER')
  async bulkStockEntry(@Body() dto: BulkStockEntryDto) {
    return this.inventoryService.bulkStockEntry(dto);
  }

  @Patch(':id/price')
  @Roles('OWNER')
  async updateItemPrice(
    @Param('id') id: string,
    @Body() dto: UpdateItemPriceDto,
    @CurrentUser() user: any,
  ) {
    return this.inventoryService.updateItemPrice(id, dto, user);
  }

  @Patch(':id/visibility')
  @Roles('OWNER')
  async toggleItemPublicVisibility(@Param('id') id: string) {
    return this.inventoryService.toggleItemPublicVisibility(id);
  }
}
