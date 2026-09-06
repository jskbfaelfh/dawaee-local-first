import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to ensure expenses table exists in tenant schema
   */
  private async ensureTablesExist(schemaName: string) {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."expenses" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "category" VARCHAR(50) NOT NULL DEFAULT 'OTHER',
        "title" VARCHAR(255) NOT NULL,
        "amount" DECIMAL(12, 2) NOT NULL,
        "expense_date" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "recipient" VARCHAR(255),
        "notes" TEXT,
        "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * Record a new operating expense in tenant schema
   */
  async createExpense(tenantId: string, dto: CreateExpenseDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) {
      throw new BadRequestException('الصيدلية غير متوفرة');
    }

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    const category = dto.category || 'OTHER';
    const expenseDate = dto.expenseDate ? new Date(dto.expenseDate) : new Date();

    const result = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      INSERT INTO "${schema}"."expenses" (
        "category", "title", "amount", "expense_date", "recipient", "notes"
      ) VALUES (
        $1, $2, $3, $4, $5, $6
      ) RETURNING id;
    `,
      category,
      dto.title,
      dto.amount,
      expenseDate,
      dto.recipient || null,
      dto.notes || null
    );

    return {
      message: 'تم تسجيل المصروف بنجاح',
      id: result[0].id,
      title: dto.title,
      amount: dto.amount,
      category,
    };
  }

  /**
   * Get list of expenses with optional category and date filters
   */
  async getExpenses(tenantId: string, category?: string, startDate?: string, endDate?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) return { expenses: [], totalExpenses: 0, byCategory: {} };

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    let whereClauses: string[] = [];

    if (category && category !== 'ALL') {
      whereClauses.push(`category = '${category}'`);
    }

    if (startDate) {
      const cleanStart = startDate.includes(' ') ? startDate : `${startDate} 00:00:00`;
      whereClauses.push(`expense_date >= '${cleanStart}'::timestamp`);
    }

    if (endDate) {
      const cleanEnd = endDate.includes(' ') ? endDate : `${endDate} 23:59:59`;
      whereClauses.push(`expense_date <= '${cleanEnd}'::timestamp`);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const expenses = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        id,
        category,
        title,
        amount,
        expense_date as "expenseDate",
        recipient,
        notes,
        created_at as "createdAt"
      FROM "${schema}"."expenses"
      ${whereStr}
      ORDER BY expense_date DESC, created_at DESC;
    `);

    // Category aggregations
    const totalsByCategory = await this.prisma.$queryRawUnsafe<Array<{ category: string; total: string }>>(`
      SELECT category, SUM(amount)::text as total
      FROM "${schema}"."expenses"
      ${whereStr}
      GROUP BY category;
    `);

    const byCategory: Record<string, number> = {};
    let totalExpenses = 0;

    for (const row of totalsByCategory) {
      const val = Number(row.total || 0);
      byCategory[row.category] = val;
      totalExpenses += val;
    }

    return {
      expenses: expenses || [],
      totalExpenses,
      byCategory,
    };
  }

  /**
   * Delete an expense entry
   */
  async deleteExpense(tenantId: string, id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.schemaName) throw new NotFoundException('الصيدلية غير متوفرة');

    const schema = tenant.schemaName;
    await this.ensureTablesExist(schema);

    await this.prisma.$executeRawUnsafe(`
      DELETE FROM "${schema}"."expenses" WHERE id = $1;
    `, id);

    return { message: 'تم حذف المصروف بنجاح' };
  }
}
