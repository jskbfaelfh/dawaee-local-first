import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { PrismaService } from '../src/database/prisma.service';
import { TenantMigrationService } from '../src/database/migrations/tenant-migration.service';

async function run() {
  console.log('================================================================');
  console.log('📦 DAWAEE MULTI-TENANT DATABASE MIGRATION RUNNER');
  console.log('================================================================\n');

  const prisma = new PrismaService();
  await prisma.$connect();
  const migrationService = new TenantMigrationService(prisma);

  try {
    const report = await migrationService.migrateAllTenants();

    console.log('\n----------------------------------------------------------------');
    console.log(`📊 Migration Summary:`);
    console.log(`   Total Pharmacy Schemas:  ${report.totalTenants}`);
    console.log(`   Successfully Migrated:   ${report.successfulTenants}`);
    console.log(`   Failed Schemas:          ${report.failedTenants}`);
    console.log(`   New Migrations Applied:  ${report.totalMigrationsApplied}`);
    console.log('----------------------------------------------------------------\n');

    for (const d of report.details) {
      const statusIcon = d.success ? '✅' : '❌';
      console.log(
        `${statusIcon} [${d.tenantName}] (${d.schemaName}): ${d.appliedCount} migrations applied ${d.appliedMigrations.length ? `[${d.appliedMigrations.join(', ')}]` : '(Already up to date)'}`,
      );
      if (d.error) {
        console.error(`   Error: ${d.error}`);
      }
    }

    if (report.failedTenants > 0) {
      console.error('\n❌ One or more tenant migrations failed!');
      await prisma.$disconnect();
      process.exit(1);
    } else {
      console.log('\n🎉 ALL TENANT SCHEMAS ARE 100% SYNCHRONIZED AND UP TO DATE!');
      await prisma.$disconnect();
      process.exit(0);
    }
  } catch (err: any) {
    console.error('❌ Fatal error during tenant migrations:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

run();
