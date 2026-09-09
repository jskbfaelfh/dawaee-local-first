import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChainService } from './chain.service';
import {
  LinkBranchDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './dto/chain.dto';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('chain')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
export class ChainController {
  constructor(private readonly chainService: ChainService) {}

  @Get('overview')
  @Roles('OWNER')
  async getChainOverview() {
    return this.chainService.getChainOverview();
  }

  @Post('link-branch')
  @Roles('OWNER')
  async linkBranch(@Body() dto: LinkBranchDto) {
    return this.chainService.linkBranch(dto);
  }

  @Get('cross-stock/:medicineId')
  async checkCrossBranchStock(@Param('medicineId', new ParseUUIDPipe({ version: '4' })) medicineId: string) {
    return this.chainService.checkCrossBranchStock(medicineId);
  }

  @Get('transfers')
  async getTransfers(@Query('type') type?: 'ALL' | 'INCOMING' | 'OUTGOING') {
    return this.chainService.getTransfers(type || 'ALL');
  }

  @Post('transfers')
  @Roles('OWNER')
  async createStockTransfer(@Body() dto: CreateStockTransferDto) {
    return this.chainService.createStockTransfer(dto);
  }

  @Post('transfers/:id/receive')
  @Roles('OWNER')
  async receiveStockTransfer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReceiveStockTransferDto,
  ) {
    return this.chainService.receiveStockTransfer(id, dto);
  }

  @Post('transfers/:id/cancel')
  @Roles('OWNER')
  async cancelStockTransfer(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.chainService.cancelStockTransfer(id);
  }
}
