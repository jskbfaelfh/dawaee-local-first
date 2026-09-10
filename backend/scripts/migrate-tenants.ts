import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantMigrationService } from '../src/database/migrations/tenant-migration.service';

async function run() {
  console.log('================================================================');
  console.log('📦 DAWAEE MULTI-TENANT DATABASE MIGRATION RUNNER');
  console.log('================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const migrationService = app.get(TenantMigrationService);

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
      console.log(`${statusIcon} [${d.tenantName}] (${d.schemaName}): ${d.appliedCount} migrations applied ${d.appliedMigrations.length ? `[${d.appliedMigrations.join(', ')}]` : '(Already up to date)'}`);
      if (d.error) {
        console.error(`   Error: ${d.error}`);
      }
    }

    if (report.failedTenants > 0) {
      console.error('\n❌ One or more tenant migrations failed!');
      await app.close();
      process.exit(1);
    } else {
      console.log('\n🎉 ALL TENANT SCHEMAS ARE 100% SYNCHRONIZED AND UP TO DATE!');
      await app.close();
      process.exit(0);
    }
  } catch (err: any) {
    console.error('❌ Fatal error during tenant migrations:', err.message);
    await app.close();
    process.exit(1);
  }
}

run();
