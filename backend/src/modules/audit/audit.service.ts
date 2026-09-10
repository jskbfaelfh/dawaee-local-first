import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { validateAndSanitizeSchemaName } from '../../common/utils/security.util';
import { AuditLogQueryDto, CreateAuditLogEntry } from './dto/audit-log.dto';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Safely records an audit log entry in the tenant schema.
   * Fail-safe: Audit failure will NOT interrupt the primary business transaction.
   */
  async log(entry: CreateAuditLogEntry, explicitSchema?: string): Promise<void> {
    try {
      const schemaName = explicitSchema || this.tenantContext.getSchemaName();
      if (!schemaName) return;
      const validSchema = validateAndSanitizeSchemaName(schemaName);

      const ctx = this.tenantContext.getContext();
      const userId = entry.userId !== undefined ? entry.userId : ctx?.userId || null;
      const userRole = entry.userRole !== undefined ? entry.userRole : ctx?.role || null;
      const userName = entry.userName || null;

      const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
      const logId = crypto.randomUUID();

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "${validSchema}".audit_logs
         (id, user_id, user_name, user_role, action, entity_type, entity_id, description, details, ip_address, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW())`,
        logId,
        userId,
        userName,
        userRole,
        entry.action,
        entry.entityType,
        entry.entityId || null,
        entry.description,
        detailsJson,
        entry.ipAddress || null,
      );
    } catch (err: any) {
      this.logger.warn(`Failed to record audit log entry [${entry.action}]: ${err.message}`);
    }
  }

  /**
   * Fetch paginated audit logs with search, user, date, and action filters.
   */
  async getLogs(query: AuditLogQueryDto) {
    const schemaName = this.tenantContext.getSchemaName();
    const validSchema = validateAndSanitizeSchemaName(schemaName);

    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (query.action && query.action !== 'ALL') {
      params.push(query.action.trim());
      conditions.push(`action = $${params.length}`);
    }

    if (query.entityType && query.entityType !== 'ALL') {
      params.push(query.entityType.trim());
      conditions.push(`entity_type = $${params.length}`);
    }

    if (query.userId && query.userId.trim().length > 0) {
      params.push(query.userId.trim());
      conditions.push(`user_id = $${params.length}::uuid`);
    }

    if (query.from && query.to) {
      params.push(`${query.from} 00:00:00`, `${query.to} 23:59:59`);
      conditions.push(`created_at >= $${params.length - 1}::timestamp AND created_at <= $${params.length}::timestamp`);
    } else if (query.from) {
      params.push(`${query.from} 00:00:00`);
      conditions.push(`created_at >= $${params.length}::timestamp`);
    }

    if (query.search && query.search.trim().length > 0) {
      const q = `%${query.search.trim()}%`;
      params.push(q);
      const idx = params.length;
      conditions.push(`(description ILIKE $${idx} OR user_name ILIKE $${idx} OR entity_id ILIKE $${idx})`);
    }

    const whereClause = conditions.join(' AND ');

    // 1. Get total count
    const countSql = `SELECT COUNT(*)::int as total FROM "${validSchema}".audit_logs WHERE ${whereClause};`;
    const countRes: any[] = await this.prisma.$queryRawUnsafe(countSql, ...params);
    const total = Number(countRes[0]?.total || 0);

    // 2. Get paginated results
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
    const offset = (page - 1) * limit;

    const listParams = [...params, limit, offset];
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;

    const listSql = `
      SELECT 
        id,
        user_id as "userId",
        user_name as "userName",
        user_role as "userRole",
        action,
        entity_type as "entityType",
        entity_id as "entityId",
        description,
        details,
        ip_address as "ipAddress",
        created_at as "createdAt"
      FROM "${validSchema}".audit_logs
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const logs: any[] = await this.prisma.$queryRawUnsafe(listSql, ...listParams);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get summary statistics of audit actions.
   */
  async getStats() {
    const schemaName = this.tenantContext.getSchemaName();
    const validSchema = validateAndSanitizeSchemaName(schemaName);

    const statsSql = `
      SELECT 
        COUNT(*)::int as "totalLogs",
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END)::int as "todayLogs",
        COUNT(CASE WHEN action = 'UPDATE_PRICE' THEN 1 END)::int as "priceChanges",
        COUNT(CASE WHEN action = 'PROCESS_RETURN' THEN 1 END)::int as "returnsCount",
        COUNT(CASE WHEN action = 'RECONCILE_STOCKTAKE' THEN 1 END)::int as "stocktakesCount",
        COUNT(CASE WHEN action LIKE 'USER_%' OR action LIKE '%PASSWORD%' THEN 1 END)::int as "userActions"
      FROM "${validSchema}".audit_logs;
    `;

    const res: any[] = await this.prisma.$queryRawUnsafe(statsSql);
    const row = res[0] || {};

    return {
      totalLogs: Number(row.totalLogs || 0),
      todayLogs: Number(row.todayLogs || 0),
      priceChanges: Number(row.priceChanges || 0),
      returnsCount: Number(row.returnsCount || 0),
      stocktakesCount: Number(row.stocktakesCount || 0),
      userActions: Number(row.userActions || 0),
    };
  }
}
