import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma.service';
import { validateAndSanitizeSchemaName } from '../../common/utils/security.util';

export interface TenantMigration {
  name: string;
  description: string;
  sql: (schema: string) => string[];
  postRun?: (tx: any, schema: string) => Promise<void>;
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
   * Helper to execute SQL statements sequentially.
   */
  public async execBatch(client: any, queries: string[]): Promise<void> {
    for (const query of queries) {
      const trimmed = query.trim();
      if (trimmed) {
        await client.$executeRawUnsafe(trimmed);
      }
    }
  }

  /**
   * Computes a deterministic SHA-256 checksum based on migration name AND exact SQL query contents.
   */
  public getMigrationChecksum(migration: TenantMigration, schemaName: string = 'template_schema'): string {
    const rawSqlLines = migration.sql(schemaName).map((s) => s.trim().replace(/\s+/g, ' '));
    const content = `${migration.name}\n${rawSqlLines.join('\n')}`;
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
  }

  /**
   * Complete, versioned list of Tenant Schema Migrations.
   * Migrations are strictly immutable and executed sequentially in exact index order.
   * Every migration enforces FULL structural synchronization (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS)
   * to guarantee 100% parity across both fresh installations and legacy existing tenants.
   */
  public readonly migrations: TenantMigration[] = [
    // ----------------------------------------------------------------
    // 001: Core Tables (Users, Inventory, Sales, Returns, Shift Logs)
    // ----------------------------------------------------------------
    {
      name: '001_core_tables',
      description: 'Create core pharmacy tables with full backward-compatible column guarantees',
      sql: (schema: string) => [
        // 1. Users table
        `CREATE TABLE IF NOT EXISTS "${schema}".users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'CASHIER',
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW()
        )`,
        `ALTER TABLE "${schema}".users
          ADD COLUMN IF NOT EXISTS name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS username VARCHAR(100),
          ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
          ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'CASHIER',
          ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,

        // 2. Inventory Items table
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
        `ALTER TABLE "${schema}".inventory_items
          ADD COLUMN IF NOT EXISTS medicine_id UUID,
          ADD COLUMN IF NOT EXISTS custom_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS units_per_pack INT DEFAULT 1,
          ADD COLUMN IF NOT EXISTS selling_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS selling_price_unit DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS min_alert_units INT DEFAULT 5,
          ADD COLUMN IF NOT EXISTS is_public_visible BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS shelf_location VARCHAR(100),
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,

        // 3. Inventory Batches table
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
          expiry_date DATE,
          is_recalled BOOLEAN DEFAULT FALSE,
          is_bonus BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        )`,
        `ALTER TABLE "${schema}".inventory_batches
          ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
          ADD COLUMN IF NOT EXISTS supplier_id UUID,
          ADD COLUMN IF NOT EXISTS purchase_id UUID,
          ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS purchase_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS selling_price_pack DECIMAL(12, 2),
          ADD COLUMN IF NOT EXISTS selling_price_unit DECIMAL(12, 2),
          ADD COLUMN IF NOT EXISTS quantity_units_remaining NUMERIC(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS expiry_date DATE,
          ADD COLUMN IF NOT EXISTS is_recalled BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_batch_exp" ON "${schema}".inventory_batches (expiry_date)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_batch_item" ON "${schema}".inventory_batches (inventory_item_id)`,

        // 4. Sales table
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
        `ALTER TABLE "${schema}".sales
          ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50),
          ADD COLUMN IF NOT EXISTS user_id UUID,
          ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS offline_id VARCHAR(100),
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${schema}_sales_offline_id" ON "${schema}".sales (offline_id) WHERE offline_id IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_sales_dt" ON "${schema}".sales (created_at)`,

        // 5. Sale Items table
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
        `ALTER TABLE "${schema}".sale_items
          ADD COLUMN IF NOT EXISTS sale_id UUID,
          ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
          ADD COLUMN IF NOT EXISTS inventory_batch_id UUID,
          ADD COLUMN IF NOT EXISTS unit_type VARCHAR(10) DEFAULT 'PACK',
          ADD COLUMN IF NOT EXISTS quantity DECIMAL(12, 2) DEFAULT 1,
          ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_price DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cost_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cost_price_unit DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12, 2) DEFAULT 0`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_sale_items_sale" ON "${schema}".sale_items (sale_id)`,

        // 6. Returns table
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
        `ALTER TABLE "${schema}".returns
          ADD COLUMN IF NOT EXISTS sale_id UUID,
          ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
          ADD COLUMN IF NOT EXISTS inventory_batch_id UUID,
          ADD COLUMN IF NOT EXISTS user_id UUID,
          ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS unit_type VARCHAR(10) DEFAULT 'PACK',
          ADD COLUMN IF NOT EXISTS quantity DECIMAL(12, 2) DEFAULT 1,
          ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS item_condition VARCHAR(50) DEFAULT 'RESALEABLE',
          ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'CASH',
          ADD COLUMN IF NOT EXISTS user_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS reason TEXT,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,

        // 7. Shift Logs table
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
        `ALTER TABLE "${schema}".shift_logs
          ADD COLUMN IF NOT EXISTS user_id UUID,
          ADD COLUMN IF NOT EXISTS user_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS opening_cash NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS expected_cash NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS actual_cash NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cash_difference NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_sales_count INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_sales_amount NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'CLOSED',
          ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP DEFAULT NOW()`,
      ],
    },

    // ----------------------------------------------------------------
    // 002: Procurement & Invoices (Suppliers, Purchases, Invoices)
    // ----------------------------------------------------------------
    {
      name: '002_procurement_tables',
      description: 'Create procurement, supplier payments, and purchase invoices with full column guarantees',
      sql: (schema: string) => [
        // 1. Suppliers table
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
        `ALTER TABLE "${schema}".suppliers
          ADD COLUMN IF NOT EXISTS name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
          ADD COLUMN IF NOT EXISTS address TEXT,
          ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS balance_due DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,

        // 2. Purchases table
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
        `ALTER TABLE "${schema}".purchases
          ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS supplier_id UUID,
          ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS total_gross_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_discount_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS net_total_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'PAID',
          ADD COLUMN IF NOT EXISTS due_date DATE,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_purchases_dt" ON "${schema}".purchases (created_at)`,

        // 3. Purchase Items table
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
          batch_number VARCHAR(100),
          amortize_bonus BOOLEAN DEFAULT TRUE
        )`,
        `ALTER TABLE "${schema}".purchase_items
          ADD COLUMN IF NOT EXISTS purchase_id UUID,
          ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
          ADD COLUMN IF NOT EXISTS quantity_packs DECIMAL(12, 2) DEFAULT 1,
          ADD COLUMN IF NOT EXISTS bonus_packs DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS units_per_pack INT DEFAULT 1,
          ADD COLUMN IF NOT EXISTS purchase_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS net_cost_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS selling_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS selling_price_unit DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS expiry_date DATE,
          ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS amortize_bonus BOOLEAN DEFAULT TRUE`,

        // 4. Supplier Payments table
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
        `ALTER TABLE "${schema}".supplier_payments
          ADD COLUMN IF NOT EXISTS supplier_id UUID,
          ADD COLUMN IF NOT EXISTS purchase_id UUID,
          ADD COLUMN IF NOT EXISTS amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS payment_date DATE DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'CASH',
          ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS receipt_image TEXT,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_supp_pay_dt" ON "${schema}".supplier_payments (created_at)`,

        // 5. Purchase Invoices table
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
        `ALTER TABLE "${schema}".purchase_invoices
          ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS supplier_id UUID,
          ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS invoice_date DATE DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS early_discount_days INT,
          ADD COLUMN IF NOT EXISTS early_discount_percent DECIMAL(5, 2),
          ADD COLUMN IF NOT EXISTS early_discount_deadline DATE,
          ADD COLUMN IF NOT EXISTS early_discount_amount DECIMAL(12, 2),
          ADD COLUMN IF NOT EXISTS early_discount_applied BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS early_discount_applied_amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS discount_tiers JSONB,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS items_count INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,

        // 6. Purchase Invoice Items table
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
        `ALTER TABLE "${schema}".purchase_invoice_items
          ADD COLUMN IF NOT EXISTS purchase_invoice_id UUID,
          ADD COLUMN IF NOT EXISTS medicine_id UUID,
          ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS scientific_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100),
          ADD COLUMN IF NOT EXISTS expiry_date DATE,
          ADD COLUMN IF NOT EXISTS quantity_packs DECIMAL(12, 2) DEFAULT 1,
          ADD COLUMN IF NOT EXISTS bonus_packs DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS units_per_pack INT DEFAULT 1,
          ADD COLUMN IF NOT EXISTS purchase_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS amortize_bonus BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS selling_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,

        `CREATE SEQUENCE IF NOT EXISTS "${schema}".purchase_invoice_seq START 1`,
      ],
    },

    // ----------------------------------------------------------------
    // 003: Expenses Table
    // ----------------------------------------------------------------
    {
      name: '003_expenses_table',
      description: 'Create operating expenses table with complete column and index guarantees',
      sql: (schema: string) => [
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
        `ALTER TABLE "${schema}".expenses
          ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'OTHER',
          ADD COLUMN IF NOT EXISTS title VARCHAR(255),
          ADD COLUMN IF NOT EXISTS amount DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS expense_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS recipient VARCHAR(255),
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_expenses_dt" ON "${schema}".expenses (expense_date)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_expenses_cat" ON "${schema}".expenses (category)`,
      ],
    },

    // ----------------------------------------------------------------
    // 004: Stocktake Sessions & Items
    // ----------------------------------------------------------------
    {
      name: '004_stocktake_tables',
      description: 'Create stocktake auditing sessions and variance items with complete column guarantees',
      sql: (schema: string) => [
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
        `ALTER TABLE "${schema}".stocktake_sessions
          ADD COLUMN IF NOT EXISTS title VARCHAR(255),
          ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'ANNUAL',
          ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'IN_PROGRESS',
          ADD COLUMN IF NOT EXISTS shelf_filter VARCHAR(100),
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS total_system_items INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_counted_items INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_variance_units INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_deficit_cost DECIMAL(14, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total_surplus_cost DECIMAL(14, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS net_variance_cost DECIMAL(14, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
          ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(150),
          ADD COLUMN IF NOT EXISTS reconciled_by_user_id UUID,
          ADD COLUMN IF NOT EXISTS reconciled_by_name VARCHAR(150),
          ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,

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
        `ALTER TABLE "${schema}".stocktake_items
          ADD COLUMN IF NOT EXISTS session_id UUID,
          ADD COLUMN IF NOT EXISTS inventory_item_id UUID,
          ADD COLUMN IF NOT EXISTS medicine_id UUID,
          ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS scientific_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS dosage_form VARCHAR(100),
          ADD COLUMN IF NOT EXISTS strength VARCHAR(100),
          ADD COLUMN IF NOT EXISTS barcode VARCHAR(100),
          ADD COLUMN IF NOT EXISTS shelf_location VARCHAR(100),
          ADD COLUMN IF NOT EXISTS units_per_pack INT DEFAULT 1,
          ADD COLUMN IF NOT EXISTS purchase_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS selling_price_pack DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS system_units INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS system_packs INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS system_loose INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS counted_packs INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS counted_loose INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS counted_total_units INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS variance_units INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS variance_packs NUMERIC(10, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS variance_cost DECIMAL(14, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS variance_retail DECIMAL(14, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS variance_status VARCHAR(20) DEFAULT 'UNCOUNTED',
          ADD COLUMN IF NOT EXISTS counted_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_stocktake_items_session" ON "${schema}".stocktake_items (session_id)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_stocktake_items_barcode" ON "${schema}".stocktake_items (barcode)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_stocktake_items_inv" ON "${schema}".stocktake_items (inventory_item_id)`,
      ],
    },

    // ----------------------------------------------------------------
    // 005: Indexes, Deduplication & Decimal Quantities
    // ----------------------------------------------------------------
    {
      name: '005_indexes_and_decimal_hardening',
      description: 'Enforce unique medicine index per tenant, deduplication, and decimal quantity hardening',
      sql: (schema: string) => [
        `ALTER TABLE "${schema}".inventory_items
          ADD COLUMN IF NOT EXISTS custom_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS is_public_visible BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS shelf_location VARCHAR(100)`,
        `ALTER TABLE "${schema}".inventory_batches
          ADD COLUMN IF NOT EXISTS supplier_id UUID,
          ADD COLUMN IF NOT EXISTS purchase_id UUID,
          ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT FALSE`,
        `ALTER TABLE "${schema}".inventory_batches ALTER COLUMN expiry_date DROP NOT NULL`,
        `ALTER TABLE "${schema}".purchase_invoices ADD COLUMN IF NOT EXISTS discount_tiers JSONB`,
        `ALTER TABLE "${schema}".purchase_invoice_items
          ADD COLUMN IF NOT EXISTS bonus_packs DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS amortize_bonus BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE "${schema}".purchase_invoice_items ALTER COLUMN expiry_date DROP NOT NULL`,
        `ALTER TABLE "${schema}".purchase_items
          ADD COLUMN IF NOT EXISTS bonus_packs DECIMAL(12, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS amortize_bonus BOOLEAN DEFAULT TRUE`,
        `ALTER TABLE "${schema}".purchase_items ALTER COLUMN expiry_date DROP NOT NULL`,
        `CREATE SEQUENCE IF NOT EXISTS "${schema}".purchase_invoice_seq START 1`,
      ],
      postRun: async (tx, schema) => {
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

        // Create Unique Index on inventory_items (medicine_id)
        await tx.$executeRawUnsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${schema}_inv_med_unique" ON "${schema}".inventory_items (medicine_id)`
        );

        // Align column types
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

    // ----------------------------------------------------------------
    // 006: Enterprise Audit Logs Table
    // ----------------------------------------------------------------
    {
      name: '006_audit_logs_table',
      description: 'Create enterprise audit logs table with indexes for administrative tracking',
      sql: (schema: string) => [
        `CREATE TABLE IF NOT EXISTS "${schema}".audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID,
          user_name VARCHAR(255),
          user_role VARCHAR(50),
          action VARCHAR(100) NOT NULL,
          entity_type VARCHAR(100) NOT NULL,
          entity_id VARCHAR(100),
          description TEXT,
          details JSONB,
          ip_address VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )`,
        `ALTER TABLE "${schema}".audit_logs
          ADD COLUMN IF NOT EXISTS user_id UUID,
          ADD COLUMN IF NOT EXISTS user_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS user_role VARCHAR(50),
          ADD COLUMN IF NOT EXISTS action VARCHAR(100),
          ADD COLUMN IF NOT EXISTS entity_type VARCHAR(100),
          ADD COLUMN IF NOT EXISTS entity_id VARCHAR(100),
          ADD COLUMN IF NOT EXISTS description TEXT,
          ADD COLUMN IF NOT EXISTS details JSONB,
          ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100),
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_audit_action" ON "${schema}".audit_logs (action)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_audit_entity" ON "${schema}".audit_logs (entity_type, entity_id)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_audit_dt" ON "${schema}".audit_logs (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS "idx_${schema}_audit_user" ON "${schema}".audit_logs (user_id)`,
      ],
    },
  ];

  /**
   * Ensures the internal migrations tracking table exists in the tenant schema.
   */
  public async ensureMigrationTable(schemaName: string): Promise<void> {
    const validSchema = validateAndSanitizeSchemaName(schemaName);
    await this.execBatch(this.prisma, [
      `CREATE SCHEMA IF NOT EXISTS "${validSchema}"`,
      `CREATE TABLE IF NOT EXISTS "${validSchema}"."_tenant_migrations" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum VARCHAR(64)
      )`,
    ]);
  }

  /**
   * Fetches the map of applied migration names to their recorded checksums.
   */
  public async getAppliedMigrations(schemaName: string): Promise<Map<string, string>> {
    const validSchema = validateAndSanitizeSchemaName(schemaName);
    await this.ensureMigrationTable(validSchema);

    const rows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT name, checksum FROM "${validSchema}"."_tenant_migrations" ORDER BY id ASC;
    `);

    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.name, r.checksum || '');
    }
    return map;
  }

  /**
   * Migrates a single Tenant schema up to the latest migration version atomically.
   * Acquires a tenant transaction-level advisory lock to eliminate concurrent migration collisions.
   */
  public async migrateSingleTenant(schemaName: string): Promise<{ appliedCount: number; appliedMigrations: string[] }> {
    const validSchema = validateAndSanitizeSchemaName(schemaName);
    await this.ensureMigrationTable(validSchema);

    const appliedMap = await this.getAppliedMigrations(validSchema);
    const appliedMigrations: string[] = [];

    // 1. Audit already applied migrations for checksum integrity (Tamper Detection)
    for (const migration of this.migrations) {
      if (appliedMap.has(migration.name)) {
        const recordedChecksum = appliedMap.get(migration.name);
        const currentChecksum = this.getMigrationChecksum(migration, validSchema);
        if (recordedChecksum && recordedChecksum !== currentChecksum) {
          this.logger.warn(
            `⚠️ Migration checksum mismatch detected for [${migration.name}] in schema [${validSchema}]. Recorded: ${recordedChecksum}, Computed: ${currentChecksum}. Migration files must remain immutable.`,
          );
        }
      }
    }

    // 2. Filter pending migrations
    const pending = this.migrations.filter((m) => !appliedMap.has(m.name));

    if (pending.length === 0) {
      return { appliedCount: 0, appliedMigrations: [] };
    }

    // 3. Execute each pending migration in its own atomic PostgreSQL transaction with advisory lock
    for (const migration of pending) {
      this.logger.log(`Applying migration [${migration.name}] to schema [${validSchema}]...`);
      const checksum = this.getMigrationChecksum(migration, validSchema);

      await this.prisma.$transaction(
        async (tx) => {
          // Tenant Transaction Advisory Lock
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, validSchema);

          const queries = migration.sql(validSchema);
          await this.execBatch(tx, queries);

          if (migration.postRun) {
            await migration.postRun(tx, validSchema);
          }

          await tx.$executeRawUnsafe(
            `INSERT INTO "${validSchema}"."_tenant_migrations" (name, applied_at, checksum)
             VALUES ($1, NOW(), $2)
             ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum;`,
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
   * Protected by PostgreSQL Global Advisory Lock to prevent concurrent server deployments from conflicting.
   */
  public async migrateAllTenants(): Promise<MigrationSummaryReport> {
    this.logger.log('🚀 Starting Multi-Tenant Database Migration run across all tenant schemas...');

    const GLOBAL_MIGRATION_LOCK_ID = 987654321;
    let lockAcquired = false;

    try {
      const lockRes: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT pg_try_advisory_lock(${GLOBAL_MIGRATION_LOCK_ID}) as acquired;`
      );
      lockAcquired = !!(lockRes && lockRes[0] && (lockRes[0].acquired === true || lockRes[0].acquired === 't'));

      if (!lockAcquired) {
        this.logger.warn(
          '⚠️ Another deployment or migration runner is currently holding the global migration advisory lock. Skipping concurrent execution.',
        );
        return {
          totalTenants: 0,
          successfulTenants: 0,
          failedTenants: 0,
          totalMigrationsApplied: 0,
          details: [],
        };
      }

      const tenants = await this.prisma.tenant.findMany({
        select: { id: true, name: true, schemaName: true },
        orderBy: { createdAt: 'asc' },
      });

      const validTenants = tenants.filter((t) => !!t.schemaName);

      const report: MigrationSummaryReport = {
        totalTenants: validTenants.length,
        successfulTenants: 0,
        failedTenants: 0,
        totalMigrationsApplied: 0,
        details: [],
      };

      for (const t of validTenants) {
        try {
          const { appliedCount, appliedMigrations } = await this.migrateSingleTenant(t.schemaName!);
          report.successfulTenants++;
          report.totalMigrationsApplied += appliedCount;
          report.details.push({
            tenantId: t.id,
            tenantName: t.name,
            schemaName: t.schemaName!,
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
            schemaName: t.schemaName!,
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
    } finally {
      if (lockAcquired) {
        await this.prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${GLOBAL_MIGRATION_LOCK_ID});`).catch((e) => {
          this.logger.error(`Failed to release global advisory lock: ${e.message}`);
        });
      }
    }
  }
}
