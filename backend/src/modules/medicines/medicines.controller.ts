import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MedicinesService } from './medicines.service';
import { CreateMedicineDto, QueryMedicineDto } from './dto/create-medicine.dto';

@Controller('medicines')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MedicinesController {
  constructor(private readonly medicinesService: MedicinesService) {}

  @Get('master-catalog')
  @Roles('SUPER_ADMIN')
  async getMasterCatalog(
    @Query('search') search?: string,
    @Query('filter') filter?: 'ALL' | 'VERIFIED' | 'UNVERIFIED',
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.medicinesService.getMasterCatalog(search, filter, page, limit);
  }

  @Get('unverified')
  @Roles('SUPER_ADMIN')
  async getUnverified(@Query('search') search?: string) {
    return this.medicinesService.getUnverified(search);
  }

  @Get('search')
  async search(@Query() query: QueryMedicineDto) {
    return this.medicinesService.search(query);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.medicinesService.findById(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OWNER')
  async create(
    @Body() dto: CreateMedicineDto,
    @CurrentUser() user: any,
  ) {
    const isSuperAdmin = user?.role === 'SUPER_ADMIN';
    return this.medicinesService.create(dto, isSuperAdmin);
  }

  @Post(':id/verify')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async verifyMedicine(
    @Param('id') id: string,
    @Body() body?: Partial<CreateMedicineDto>,
  ) {
    return this.medicinesService.verifyMedicine(id, body);
  }

  @Post('delete-medicine/:id')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async deleteMedicine(@Param('id') id: string) {
    return this.medicinesService.deleteMedicine(id);
  }

  @Post(':id/update')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async updateMasterMedicine(
    @Param('id') id: string,
    @Body() dto: Partial<CreateMedicineDto>,
  ) {
    return this.medicinesService.updateMasterMedicine(id, dto);
  }

  @Post('ai-smart-search')
  @HttpCode(HttpStatus.OK)
  async aiSmartSearch(
    @Body() body: { query: string; inStockOnly?: boolean },
    @Param() _params: any,
    @Query() _query: any,
    @Body() _body: any,
  ) {
    // Note: Request user context is extracted via MedicinesService using TenantContext or Prisma
    return this.medicinesService.aiSmartSearch(body.query, body.inStockOnly);
  }

  @Post('seed')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async seed() {
    return this.medicinesService.seedInitialMedicines();
  }
}
