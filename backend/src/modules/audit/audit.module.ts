import { Module, Global } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { AuditLogController } from './audit.controller';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
