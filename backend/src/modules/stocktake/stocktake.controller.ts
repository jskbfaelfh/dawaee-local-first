import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { StocktakeService } from './stocktake.service';
import {
  CreateStocktakeSessionDto,
  RecordItemCountDto,
  ReconcileStocktakeDto,
} from './dto/stocktake.dto';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('stocktake')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
export class StocktakeController {
  constructor(private readonly stocktakeService: StocktakeService) {}

  @Post('sessions')
  @Roles('OWNER')
  async createSession(
    @Body() dto: CreateStocktakeSessionDto,
    @CurrentUser() user: any,
  ) {
    return this.stocktakeService.createSession(dto, user);
  }

  @Get('sessions')
  @Roles('OWNER')
  async getSessions() {
    return this.stocktakeService.getSessions();
  }

  @Get('sessions/:id')
  @Roles('OWNER')
  async getSessionDetails(
    @Param('id') id: string,
    @Query() query: { search?: string; shelf?: string; status?: string },
  ) {
    return this.stocktakeService.getSessionDetails(id, query);
  }

  @Post('sessions/:id/count')
  @Roles('OWNER')
  async recordCount(
    @Param('id') id: string,
    @Body() dto: RecordItemCountDto,
  ) {
    return this.stocktakeService.recordCount(id, dto);
  }

  @Post('sessions/:id/reconcile')
  @Roles('OWNER')
  async reconcileSession(
    @Param('id') id: string,
    @Body() dto: ReconcileStocktakeDto,
    @CurrentUser() user: any,
  ) {
    return this.stocktakeService.reconcileSession(id, dto, user);
  }

  @Delete('sessions/:id')
  @Roles('OWNER')
  async deleteSession(@Param('id') id: string) {
    return this.stocktakeService.deleteSession(id);
  }
}
