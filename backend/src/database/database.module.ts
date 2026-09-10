import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { LocalDbService } from './local-db.service';
import { CloudSyncService } from './cloud-sync.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { TenantMigrationService } from './migrations/tenant-migration.service';

@Global()
@Module({
  providers: [
    PrismaService,
    LocalDbService,
    CloudSyncService,
    TenantContextService,
    TenantMigrationService,
  ],
  exports: [
    PrismaService,
    LocalDbService,
    CloudSyncService,
    TenantContextService,
    TenantMigrationService,
  ],
})
export class DatabaseModule {}
