import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma.service';
import { validateAndSanitizeSchemaName } from '../../common/utils/security.util';

export interface TenantMigration {
  name: string;
  description: string;
  up: (tx: any, schemaName: string) => Promise<void>;
}

export interface TenantMigrationResult {
  tenantId: string;
  schemaName: string;
  tenantName: string;
  appliedCount: number;
  appliedMigrations: string[];
  success: boolean;
  error?: string;
}

export interface MigrationSummaryReport {
  totalTenants: number;
  successfulTenants: number;
  failedTenants: number;
  totalMigrationsApplied: number;
  details: TenantMigrationResult[];
}

@Injectable()
export class TenantMigrationService {
  private readonly logger = new Logger(TenantMigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to execute SQL statements sequentially to avoid multi-command prepared statement errors.
   */
  public async execBatch(client: any, ...queries: string[]): Promise<void> {
    for (const query of queries) {
      const trimmed = query.trim();
      if (trimmed) {
        await client.$executeRawUnsafe(trimmed);
      }
    }
  }

  /**
   * Complete, versioned list of Tenant Schema Migrations.
   * Migrations are immutable and executed sequentially in exact index order.
   */
  public readonly migrations: TenantMigration[] = [
    {
      name: '001_core_tables',
      description: 'Create core pharmacy tables: users, inventory_items, inventory_batches, sales, sale_items, returns, shift_logs',
      up: async (tx, schema) => {
        await this.execBatch(
          tx,
          `CREATE TABLE IF NOT EXISTS "${schema}".users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'CASHIER',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".inventory_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            medicine_id UUID NOT NULL,
            custom_name VARCHAR(255),
            units_per_pack INT NOT NULL DEFAULT 1,
            selling_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            selling_price_unit DECIMAL(12, 2) NOT NULL DEFAULT 0,
            min_alert_units INT DEFAULT 5,
            is_public_visible BOOLEAN DEFAULT TRUE,
            shelf_location VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".inventory_batches (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            inventory_item_id UUID REFERENCES "${schema}".inventory_items(id) ON DELETE CASCADE,
            supplier_id UUID,
            purchase_id UUID,
            batch_number VARCHAR(100),
            purchase_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            selling_price_pack DECIMAL(12, 2),
            selling_price_unit DECIMAL(12, 2),
            quantity_units_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,
            expiry_date DATE NOT NULL,
            is_recalled BOOLEAN DEFAULT FALSE,
            is_bonus BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_batch_exp" ON "${schema}".inventory_batches (expiry_date)`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_batch_item" ON "${schema}".inventory_batches (inventory_item_id)`,
          `CREATE TABLE IF NOT EXISTS "${schema}".sales (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number VARCHAR(50) UNIQUE NOT NULL,
            user_id UUID REFERENCES "${schema}".users(id),
            subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
            discount_amount DECIMAL(12, 2) DEFAULT 0,
            total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            offline_id VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${schema}_sales_offline_id" ON "${schema}".sales (offline_id) WHERE offline_id IS NOT NULL`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_sales_dt" ON "${schema}".sales (created_at)`,
          `CREATE TABLE IF NOT EXISTS "${schema}".sale_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sale_id UUID REFERENCES "${schema}".sales(id) ON DELETE CASCADE,
            inventory_item_id UUID REFERENCES "${schema}".inventory_items(id),
            inventory_batch_id UUID REFERENCES "${schema}".inventory_batches(id),
            unit_type VARCHAR(10) NOT NULL DEFAULT 'PACK',
            quantity DECIMAL(12, 2) NOT NULL DEFAULT 1,
            unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
            total_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
            cost_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            cost_price_unit DECIMAL(12, 2) NOT NULL DEFAULT 0,
            total_cost DECIMAL(12, 2) NOT NULL DEFAULT 0
          )`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_sale_items_sale" ON "${schema}".sale_items (sale_id)`,
          `CREATE TABLE IF NOT EXISTS "${schema}".returns (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sale_id UUID REFERENCES "${schema}".sales(id),
            inventory_item_id UUID REFERENCES "${schema}".inventory_items(id),
            inventory_batch_id UUID REFERENCES "${schema}".inventory_batches(id),
            user_id UUID REFERENCES "${schema}".users(id),
            trade_name VARCHAR(255),
            unit_type VARCHAR(10) NOT NULL DEFAULT 'PACK',
            quantity DECIMAL(12, 2) NOT NULL DEFAULT 1,
            refund_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            unit_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
            total_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
            item_condition VARCHAR(50) DEFAULT 'RESALEABLE',
            payment_method VARCHAR(50) DEFAULT 'CASH',
            user_name VARCHAR(255),
            reason TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".shift_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID,
            user_name VARCHAR(255),
            opening_cash NUMERIC DEFAULT 0,
            expected_cash NUMERIC DEFAULT 0,
            actual_cash NUMERIC DEFAULT 0,
            cash_difference NUMERIC DEFAULT 0,
            total_sales_count INT DEFAULT 0,
            total_sales_amount NUMERIC DEFAULT 0,
            notes TEXT,
            status VARCHAR(50) DEFAULT 'CLOSED',
            opened_at TIMESTAMP DEFAULT NOW(),
            closed_at TIMESTAMP DEFAULT NOW()
          )`,
        );
      },
    },
    {
      name: '002_procurement_tables',
      description: 'Create supplier, purchase, and purchase invoice tables',
      up: async (tx, schema) => {
        await this.execBatch(
          tx,
          `CREATE TABLE IF NOT EXISTS "${schema}".suppliers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            address TEXT,
            company_name VARCHAR(255),
            balance_due DECIMAL(12, 2) DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".purchases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number VARCHAR(100),
            supplier_id UUID,
            supplier_name VARCHAR(255),
            total_gross_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            total_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            net_total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
            due_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_purchases_dt" ON "${schema}".purchases (created_at)`,
          `CREATE TABLE IF NOT EXISTS "${schema}".purchase_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            purchase_id UUID REFERENCES "${schema}".purchases(id) ON DELETE CASCADE,
            inventory_item_id UUID,
            quantity_packs DECIMAL(12, 2) NOT NULL DEFAULT 1,
            bonus_packs DECIMAL(12, 2) NOT NULL DEFAULT 0,
            units_per_pack INT NOT NULL DEFAULT 1,
            purchase_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
            net_cost_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            selling_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            selling_price_unit DECIMAL(12, 2) NOT NULL DEFAULT 0,
            expiry_date DATE,
            batch_number VARCHAR(100)
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".supplier_payments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            supplier_id UUID REFERENCES "${schema}".suppliers(id) ON DELETE SET NULL,
            purchase_id UUID,
            amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
            payment_method VARCHAR(50) DEFAULT 'CASH',
            receipt_number VARCHAR(100),
            receipt_image TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_supp_pay_dt" ON "${schema}".supplier_payments (created_at)`,
          `CREATE TABLE IF NOT EXISTS "${schema}".purchase_invoices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number VARCHAR(100) NOT NULL,
            supplier_id UUID,
            supplier_name VARCHAR(255),
            invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
            total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
            early_discount_days INT,
            early_discount_percent DECIMAL(5, 2),
            early_discount_deadline DATE,
            early_discount_amount DECIMAL(12, 2),
            early_discount_applied BOOLEAN DEFAULT FALSE,
            early_discount_applied_amount DECIMAL(12, 2) DEFAULT 0,
            discount_tiers JSONB,
            notes TEXT,
            items_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".purchase_invoice_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            purchase_invoice_id UUID REFERENCES "${schema}".purchase_invoices(id) ON DELETE CASCADE,
            medicine_id UUID,
            trade_name VARCHAR(255) NOT NULL,
            scientific_name VARCHAR(255),
            batch_number VARCHAR(100),
            expiry_date DATE,
            quantity_packs DECIMAL(12, 2) NOT NULL DEFAULT 1,
            bonus_packs DECIMAL(12, 2) NOT NULL DEFAULT 0,
            units_per_pack INT NOT NULL DEFAULT 1,
            purchase_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
            amortize_bonus BOOLEAN DEFAULT TRUE,
            selling_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
            total_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE SEQUENCE IF NOT EXISTS "${schema}".purchase_invoice_seq START 1`,
        );
      },
    },
    {
      name: '003_expenses_table',
      description: 'Create operating expenses table and indexes',
      up: async (tx, schema) => {
        await this.execBatch(
          tx,
          `CREATE TABLE IF NOT EXISTS "${schema}".expenses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            category VARCHAR(50) NOT NULL DEFAULT 'OTHER',
            title VARCHAR(255) NOT NULL,
            amount DECIMAL(12, 2) NOT NULL,
            expense_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            recipient VARCHAR(255),
            notes TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_expenses_dt" ON "${schema}".expenses (expense_date)`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_expenses_cat" ON "${schema}".expenses (category)`,
        );
      },
    },
    {
      name: '004_stocktake_tables',
      description: 'Create stocktake sessions and stocktake items audit tables',
      up: async (tx, schema) => {
        await this.execBatch(
          tx,
          `CREATE TABLE IF NOT EXISTS "${schema}".stocktake_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL DEFAULT 'ANNUAL',
            status VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
            shelf_filter VARCHAR(100),
            notes TEXT,
            total_system_items INT DEFAULT 0,
            total_counted_items INT DEFAULT 0,
            total_variance_units INT DEFAULT 0,
            total_deficit_cost DECIMAL(14, 2) DEFAULT 0,
            total_surplus_cost DECIMAL(14, 2) DEFAULT 0,
            net_variance_cost DECIMAL(14, 2) DEFAULT 0,
            created_by_user_id UUID,
            created_by_name VARCHAR(150),
            reconciled_by_user_id UUID,
            reconciled_by_name VARCHAR(150),
            reconciled_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS "${schema}".stocktake_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID NOT NULL REFERENCES "${schema}".stocktake_sessions(id) ON DELETE CASCADE,
            inventory_item_id UUID NOT NULL,
            medicine_id UUID,
            trade_name VARCHAR(255) NOT NULL,
            scientific_name VARCHAR(255),
            dosage_form VARCHAR(100),
            strength VARCHAR(100),
            barcode VARCHAR(100),
            shelf_location VARCHAR(100),
            units_per_pack INT NOT NULL DEFAULT 1,
            purchase_price_pack DECIMAL(12, 2) DEFAULT 0,
            selling_price_pack DECIMAL(12, 2) DEFAULT 0,
            system_units INT NOT NULL DEFAULT 0,
            system_packs INT NOT NULL DEFAULT 0,
            system_loose INT NOT NULL DEFAULT 0,
            counted_packs INT DEFAULT 0,
            counted_loose INT DEFAULT 0,
            counted_total_units INT DEFAULT 0,
            variance_units INT DEFAULT 0,
            variance_packs NUMERIC(10, 2) DEFAULT 0,
            variance_cost DECIMAL(14, 2) DEFAULT 0,
            variance_retail DECIMAL(14, 2) DEFAULT 0,
            variance_status VARCHAR(20) DEFAULT 'UNCOUNTED',
            counted_at TIMESTAMP,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_stocktake_items_session" ON "${schema}".stocktake_items (session_id)`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_stocktake_items_barcode" ON "${schema}".stocktake_items (barcode)`,
          `CREATE INDEX IF NOT EXISTS "idx_${schema}_stocktake_items_inv" ON "${schema}".stocktake_items (inventory_item_id)`,
        );
      },
    },
    {
      name: '005_indexes_and_decimal_hardening',
      description: 'Enforce unique medicine index per tenant, decimal quantities, and performance indexes',
      up: async (tx, schema) => {
        // 1. Column ensures & Deduplication
        await this.execBatch(
          tx,
          `ALTER TABLE "${schema}".inventory_items ADD COLUMN IF NOT EXISTS custom_name VARCHAR(255)`,
          `ALTER TABLE "${schema}".inventory_items ADD COLUMN IF NOT EXISTS is_public_visible BOOLEAN DEFAULT TRUE`,
          `ALTER TABLE "${schema}".inventory_items ADD COLUMN IF NOT EXISTS shelf_location VARCHAR(100)`,
          `ALTER TABLE "${schema}".inventory_batches ADD COLUMN IF NOT EXISTS supplier_id UUID`,
          `ALTER TABLE "${schema}".inventory_batches ADD COLUMN IF NOT EXISTS purchase_id UUID`,
          `ALTER TABLE "${schema}".inventory_batches ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT FALSE`,
          `ALTER TABLE "${schema}".inventory_batches ALTER COLUMN expiry_date DROP NOT NULL`,
          `ALTER TABLE "${schema}".purchase_invoices ADD COLUMN IF NOT EXISTS discount_tiers JSONB`,
          `ALTER TABLE "${schema}".purchase_invoice_items ADD COLUMN IF NOT EXISTS bonus_packs DECIMAL(12, 2) DEFAULT 0`,
          `ALTER TABLE "${schema}".purchase_invoice_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0`,
          `ALTER TABLE "${schema}".purchase_invoice_items ADD COLUMN IF NOT EXISTS amortize_bonus BOOLEAN DEFAULT TRUE`,
          `ALTER TABLE "${schema}".purchase_invoice_items ALTER COLUMN expiry_date DROP NOT NULL`,
          `ALTER TABLE "${schema}".purchase_items ADD COLUMN IF NOT EXISTS bonus_packs DECIMAL(12, 2) DEFAULT 0`,
          `ALTER TABLE "${schema}".purchase_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0`,
          `ALTER TABLE "${schema}".purchase_items ADD COLUMN IF NOT EXISTS amortize_bonus BOOLEAN DEFAULT TRUE`,
          `ALTER TABLE "${schema}".purchase_items ALTER COLUMN expiry_date DROP NOT NULL`,
          `CREATE SEQUENCE IF NOT EXISTS "${schema}".purchase_invoice_seq START 1`,
        );

        // Deduplicate inventory_items if duplicates exist
        await tx.$executeRawUnsafe(`
          DO $$
          BEGIN
            WITH duplicates AS (
              SELECT medicine_id, MIN(id::text)::uuid as canonical_id
              FROM "${schema}".inventory_items
              GROUP BY medicine_id
              HAVING count(*) > 1
            )
            UPDATE "${schema}".inventory_batches b
            SET inventory_item_id = d.canonical_id
            FROM "${schema}".inventory_items ii
            JOIN duplicates d ON ii.medicine_id = d.medicine_id AND ii.id != d.canonical_id
            WHERE b.inventory_item_id = ii.id;

            WITH duplicates AS (
              SELECT medicine_id, MIN(id::text)::uuid as canonical_id
              FROM "${schema}".inventory_items
              GROUP BY medicine_id
              HAVING count(*) > 1
            )
            DELETE FROM "${schema}".inventory_items ii
            USING duplicates d
            WHERE ii.medicine_id = d.medicine_id AND ii.id != d.canonical_id;
          END $$;
        `);

        // 2. Create Unique Index on inventory_items (medicine_id)
        await tx.$executeRawUnsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${schema}_inv_med_unique" ON "${schema}".inventory_items (medicine_id)`
        );

        // 3. Align column types
        await tx.$executeRawUnsafe(`
          DO $$
          BEGIN
            ALTER TABLE "${schema}".sale_items ALTER COLUMN quantity TYPE DECIMAL(12, 2);
          EXCEPTION WHEN OTHERS THEN NULL;
          END $$;
        `);

        await tx.$executeRawUnsafe(`
          DO $$
          BEGIN
            ALTER TABLE "${schema}".returns ALTER COLUMN quantity TYPE DECIMAL(12, 2);
          EXCEPTION WHEN OTHERS THEN NULL;
          END $$;
        `);

        await tx.$executeRawUnsafe(`
          DO $$
          BEGIN
            ALTER TABLE "${schema}".purchase_items ALTER COLUMN quantity_packs TYPE DECIMAL(12, 2);
          EXCEPTION WHEN OTHERS THEN NULL;
          END $$;
        `);
      },
    },
  ];

  /**
   * Ensures the internal migrations tracking table exists in the tenant schema.
   */
  public async ensureMigrationTable(schemaName: string): Promise<void> {
    const validSchema = validateAndSanitizeSchemaName(schemaName);
    await this.execBatch(
      this.prisma,
      `CREATE SCHEMA IF NOT EXISTS "${validSchema}"`,
      `CREATE TABLE IF NOT EXISTS "${validSchema}"."_tenant_migrations" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum VARCHAR(64)
      )`,
    );
  }

  /**
   * Fetches the set of migration names already applied to a given tenant schema.
   */
  public async getAppliedMigrations(schemaName: string): Promise<Set<string>> {
    const validSchema = validateAndSanitizeSchemaName(schemaName);
    await this.ensureMigrationTable(validSchema);

    const rows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT name FROM "${validSchema}"."_tenant_migrations" ORDER BY id ASC;
    `);

    return new Set(rows.map((r: any) => r.name));
  }

  /**
   * Migrates a single Tenant schema up to the latest migration version atomically.
   */
  public async migrateSingleTenant(schemaName: string): Promise<{ appliedCount: number; appliedMigrations: string[] }> {
    const validSchema = validateAndSanitizeSchemaName(schemaName);
    await this.ensureMigrationTable(validSchema);

    const appliedSet = await this.getAppliedMigrations(validSchema);
    const pending = this.migrations.filter((m) => !appliedSet.has(m.name));

    if (pending.length === 0) {
      return { appliedCount: 0, appliedMigrations: [] };
    }

    const appliedMigrations: string[] = [];

    // Execute each pending migration in its own atomic PostgreSQL transaction
    for (const migration of pending) {
      this.logger.log(`Applying migration [${migration.name}] to schema [${validSchema}]...`);
      await this.prisma.$transaction(
        async (tx) => {
          await migration.up(tx, validSchema);

          const checksum = crypto.createHash('sha256').update(migration.name).digest('hex').slice(0, 16);
          await tx.$executeRawUnsafe(
            `INSERT INTO "${validSchema}"."_tenant_migrations" (name, applied_at, checksum)
             VALUES ($1, NOW(), $2)
             ON CONFLICT (name) DO NOTHING;`,
            migration.name,
            checksum,
          );
        },
        { timeout: 60000, maxWait: 15000 },
      );

      appliedMigrations.push(migration.name);
    }

    this.logger.log(`Schema [${validSchema}] migrated successfully with ${appliedMigrations.length} migrations.`);
    return { appliedCount: appliedMigrations.length, appliedMigrations };
  }

  /**
   * Discovers and runs all pending migrations across ALL provisioned tenant schemas.
   */
  public async migrateAllTenants(): Promise<MigrationSummaryReport> {
    this.logger.log('🚀 Starting Multi-Tenant Database Migration run across all tenant schemas...');

    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true, schemaName: true },
      orderBy: { createdAt: 'asc' },
    });

    const report: MigrationSummaryReport = {
      totalTenants: tenants.length,
      successfulTenants: 0,
      failedTenants: 0,
      totalMigrationsApplied: 0,
      details: [],
    };

    for (const t of tenants) {
      if (!t.schemaName) continue;

      try {
        const { appliedCount, appliedMigrations } = await this.migrateSingleTenant(t.schemaName);
        report.successfulTenants++;
        report.totalMigrationsApplied += appliedCount;
        report.details.push({
          tenantId: t.id,
          tenantName: t.name,
          schemaName: t.schemaName,
          appliedCount,
          appliedMigrations,
          success: true,
        });
      } catch (err: any) {
        this.logger.error(`Migration failed for tenant "${t.name}" (${t.schemaName}): ${err.message}`);
        report.failedTenants++;
        report.details.push({
          tenantId: t.id,
          tenantName: t.name,
          schemaName: t.schemaName,
          appliedCount: 0,
          appliedMigrations: [],
          success: false,
          error: err.message,
        });
      }
    }

    this.logger.log(
      `✅ Multi-Tenant Migration Finished: ${report.successfulTenants}/${report.totalTenants} schemas updated. Total applied migrations: ${report.totalMigrationsApplied}`,
    );

    return report;
  }
}

