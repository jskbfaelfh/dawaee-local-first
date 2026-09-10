import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuditLogService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log.dto';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async getLogs(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.getLogs(query);
  }

  @Get('stats')
  async getStats() {
    return this.auditLogService.getStats();
  }
}
