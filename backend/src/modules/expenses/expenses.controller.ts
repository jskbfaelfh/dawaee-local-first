import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';

@Controller('expenses')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  createExpense(@Request() req: any, @Body() dto: CreateExpenseDto) {
    return this.expensesService.createExpense(req.user.tenantId, dto);
  }

  @Get()
  getExpenses(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expensesService.getExpenses(req.user.tenantId, category, startDate, endDate);
  }

  @Delete(':id')
  deleteExpense(@Request() req: any, @Param('id') id: string) {
    return this.expensesService.deleteExpense(req.user.tenantId, id);
  }
}
