import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantMigrationService } from './migrations/tenant-migration.service';

@Global()
@Module({
  providers: [
    PrismaService,
    TenantContextService,
    TenantMigrationService,
  ],
  exports: [
    PrismaService,
    TenantContextService,
    TenantMigrationService,
  ],
})
export class DatabaseModule {}
