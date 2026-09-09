import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { generateSecurePassword, isWeakPassword, sanitizeTenantResponse } from '../../common/utils/security.util';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Provision a new Tenant Pharmacy with ACID safety and automatic schema rollback
   */
  async provisionPharmacy(dto: CreateTenantDto) {
    const rawSlug = dto.slug || dto.ownerUsername || `pharmacy_${Date.now()}`;
    const slug = rawSlug.toLowerCase().trim();

    // Check if slug already exists
    const existing = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (existing) {
      throw new BadRequestException('معرف الصيدلية (Slug) مسجل مسبقاً، يرجى اختيار معرف آخر');
    }

    // Generate safe schema name: ph_<slug>_<rand>
    const randSuffix = crypto.randomBytes(3).toString('hex');
    const safeSlug = slug.replace(/[^a-z0-9_]/g, '_').slice(0, 30);
    const schemaName = `ph_${safeSlug}_${randSuffix}`;

    // 1. Validate & Hash Password for Owner BEFORE doing any DDL
    const saltRounds = 10;
    let passwordHash = dto.ownerPasswordHash;
    let rawOwnerPass = dto.ownerPassword ? dto.ownerPassword.trim() : '';

    if (!passwordHash) {
      if (!rawOwnerPass) {
        rawOwnerPass = generateSecurePassword(14, 'Own-');
      }
      const weakOwner = isWeakPassword(rawOwnerPass);
      if (weakOwner.isWeak) {
        throw new BadRequestException(weakOwner.reason || 'كلمة مرور المالك ضعيفة جداً');
      }
      passwordHash = await bcrypt.hash(rawOwnerPass, saltRounds);
    }

    const ownerUserId = dto.ownerUserId || crypto.randomUUID();
    const cleanOwnerUsername = (dto.ownerUsername || 'user').toLowerCase().trim().replace(/\s+/g, '_');
    const cleanOwnerName = (dto.ownerName || 'مدير الصيدلية').trim();

    // 2. Prepare Cashier Accounts (Single or Multiple) and validate passwords
    const cashierAccounts: { username: string; password: string; name: string; id: string; hash: string }[] = [];
    const count = dto.cashierCount !== undefined ? dto.cashierCount : (dto.createCashier !== false ? 1 : 0);

    for (let i = 1; i <= count; i++) {
      const suffix = count === 1 ? '_pos' : `_pos${i}`;
      const cashierUsername = `${cleanOwnerUsername}${suffix}`;

      let cashierPassword = dto.cashierPassword?.trim();
      if (!cashierPassword) {
        cashierPassword = generateSecurePassword(12, 'Pos-');
      } else {
        const weakCashier = isWeakPassword(cashierPassword);
        if (weakCashier.isWeak) {
          throw new BadRequestException(`كلمة مرور الكاشير غير آمنة: ${weakCashier.reason}`);
        }
      }

      const cashierHash = await bcrypt.hash(cashierPassword, saltRounds);
      const cashierUserId = crypto.randomUUID();
      const cashierName = count === 1 ? `كاشير - ${dto.name}` : `كاشير ${i} - ${dto.name}`;

      cashierAccounts.push({
        id: cashierUserId,
        name: cashierName,
        username: cashierUsername,
        password: cashierPassword,
        hash: cashierHash,
      });
    }

    // 3. Calculate Subscription End Date & License Key
    const months = dto.subscriptionMonths || 12;
    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + months);
    const licenseKey = `DAWAEE-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${new Date().getFullYear()}`;

    this.logger.log(`Starting schema provisioning for "${dto.name}" with schema: ${schemaName}`);

    try {
      // 4. Execute DDL to create isolated schema and all tenant tables
      await this.createTenantSchemaAndTables(schemaName);

      // 5. Insert users and create Tenant atomically in Master DB
      const result = await this.prisma.$transaction(async (tx) => {
        // Insert Owner user record in the newly created tenant schema
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schemaName}".users (id, name, username, password_hash, role, is_active, created_at)
           VALUES ($1::uuid, $2, $3, $4, 'OWNER', TRUE, NOW())`,
          ownerUserId,
          cleanOwnerName,
          cleanOwnerUsername,
          passwordHash,
        );

        // Insert Cashier user records
        for (const c of cashierAccounts) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "${schemaName}".users (id, name, username, password_hash, role, is_active, created_at)
             VALUES ($1::uuid, $2, $3, $4, 'CASHIER', TRUE, NOW())`,
            c.id,
            c.name,
            c.username,
            c.hash,
          );
        }

        // Handle PharmacyChain if requested
        let chainId = dto.chainId || null;
        let chainRole = dto.chainRole || 'BRANCH';

        if (dto.isChain && !chainId) {
          const newChain = await tx.pharmacyChain.create({
            data: {
              name: dto.chainName || `مجموعة ${dto.name}`,
              ownerName: dto.ownerName,
              ownerPhone: dto.phone || '',
            },
          });
          chainId = newChain.id;
          chainRole = 'HQ';
        }

        // Register Tenant in Master Database
        const tenant = await tx.tenant.create({
          data: {
            name: dto.name,
            slug,
            schemaName,
            governorate: dto.governorate,
            district: dto.district,
            addressDetails: dto.addressDetails,
            googleMapsUrl: dto.googleMapsUrl,
            latitude: dto.latitude,
            longitude: dto.longitude,
            phone: dto.phone || 'غير محدد',
            licenseKey,
            subscriptionStatus: 'ACTIVE',
            subscriptionEndsAt: endsAt,
            chainId,
            chainRole,
          },
        });

        return { tenant, chainId, chainRole };
      });

      this.logger.log(`Provisioning completed successfully for tenant ID: ${result.tenant.id}`);

      return {
        tenant: sanitizeTenantResponse(result.tenant),
        ownerAccount: {
          userId: ownerUserId,
          name: dto.ownerName,
          username: cleanOwnerUsername,
          ...(rawOwnerPass ? { password: rawOwnerPass } : {}),
          role: 'OWNER',
        },
        cashierAccounts: cashierAccounts.map(({ id, name, username, password }) => ({
          userId: id,
          name,
          username,
          password,
          role: 'CASHIER',
        })),
        cashierAccount: cashierAccounts[0]
          ? {
              userId: cashierAccounts[0].id,
              name: cashierAccounts[0].name,
              username: cashierAccounts[0].username,
              password: cashierAccounts[0].password,
              role: 'CASHIER',
            }
          : null,
        oneTimeCredentials: rawOwnerPass
          ? {
              owner: {
                username: cleanOwnerUsername,
                password: rawOwnerPass,
              },
              cashiers: cashierAccounts.map(({ username, password, name }) => ({
                username,
                password,
                name,
              })),
            }
          : null,
        chainId: result.chainId,
        chainRole: result.chainRole,
      };
    } catch (err: any) {
      this.logger.error(`Provisioning failed for "${dto.name}" on schema "${schemaName}". Rolling back schema: ${err.message}`);
      try {
        await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
        this.logger.log(`Orphaned schema "${schemaName}" successfully dropped and rolled back.`);
      } catch (dropErr: any) {
        this.logger.error(`Failed to drop orphaned schema "${schemaName}": ${dropErr.message}`);
      }
      throw err;
    }
  }

  async provisionTenant(dto: CreateTenantDto) {
    return this.provisionPharmacy(dto);
  }

  /**
   * SQL DDL Execution to create all tenant tables individually
   */
  public async createTenantSchemaAndTables(schemaName: string): Promise<void> {
    const statements = [
      `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'CASHIER',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".inventory_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        medicine_id UUID NOT NULL,
        custom_name VARCHAR(255),
        units_per_pack INT NOT NULL DEFAULT 1,
        selling_price_pack DECIMAL(12, 2) NOT NULL,
        selling_price_unit DECIMAL(12, 2) NOT NULL,
        min_alert_units INT DEFAULT 5,
        is_public_visible BOOLEAN DEFAULT TRUE,
        shelf_location VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS "idx_${schemaName}_inv_med" ON "${schemaName}".inventory_items (medicine_id)`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".inventory_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inventory_item_id UUID REFERENCES "${schemaName}".inventory_items(id) ON DELETE CASCADE,
        supplier_id UUID,
        purchase_id UUID,
        batch_number VARCHAR(100),
        purchase_price_pack DECIMAL(12, 2) NOT NULL,
        selling_price_pack DECIMAL(12, 2),
        selling_price_unit DECIMAL(12, 2),
        quantity_units_remaining INT NOT NULL,
        expiry_date DATE NOT NULL,
        is_recalled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS "idx_${schemaName}_batch_exp" ON "${schemaName}".inventory_batches (expiry_date)`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".sales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        user_id UUID REFERENCES "${schemaName}".users(id),
        subtotal DECIMAL(12, 2) NOT NULL,
        discount_amount DECIMAL(12, 2) DEFAULT 0,
        total_amount DECIMAL(12, 2) NOT NULL,
        offline_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${schemaName}_sales_offline_id" ON "${schemaName}".sales (offline_id) WHERE offline_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS "idx_${schemaName}_sales_dt" ON "${schemaName}".sales (created_at)`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".sale_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id UUID REFERENCES "${schemaName}".sales(id) ON DELETE CASCADE,
        inventory_item_id UUID REFERENCES "${schemaName}".inventory_items(id),
        inventory_batch_id UUID REFERENCES "${schemaName}".inventory_batches(id),
        unit_type VARCHAR(10) NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(12, 2) NOT NULL,
        total_price DECIMAL(12, 2) NOT NULL,
        cost_price_pack DECIMAL(12, 2) NOT NULL DEFAULT 0,
        cost_price_unit DECIMAL(12, 2) NOT NULL DEFAULT 0,
        total_cost DECIMAL(12, 2) NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".returns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id UUID REFERENCES "${schemaName}".sales(id),
        inventory_item_id UUID REFERENCES "${schemaName}".inventory_items(id),
        inventory_batch_id UUID REFERENCES "${schemaName}".inventory_batches(id),
        user_id UUID REFERENCES "${schemaName}".users(id),
        trade_name VARCHAR(255),
        unit_type VARCHAR(10) NOT NULL DEFAULT 'PACK',
        quantity INT NOT NULL DEFAULT 1,
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
      `CREATE TABLE IF NOT EXISTS "${schemaName}".shift_logs (
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
      `CREATE TABLE IF NOT EXISTS "${schemaName}".suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        address TEXT,
        company_name VARCHAR(255),
        balance_due DECIMAL(12, 2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".purchases (
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
      `CREATE INDEX IF NOT EXISTS "idx_${schemaName}_purchases_dt" ON "${schemaName}".purchases (created_at)`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".purchase_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_id UUID,
        inventory_item_id UUID,
        quantity_packs INT NOT NULL,
        bonus_packs INT NOT NULL DEFAULT 0,
        units_per_pack INT NOT NULL DEFAULT 1,
        purchase_price_pack DECIMAL(12, 2) NOT NULL,
        discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
        net_cost_pack DECIMAL(12, 2) NOT NULL,
        selling_price_pack DECIMAL(12, 2) NOT NULL,
        selling_price_unit DECIMAL(12, 2) NOT NULL,
        expiry_date DATE,
        batch_number VARCHAR(100)
      )`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".supplier_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id UUID,
        purchase_id UUID,
        amount DECIMAL(12, 2) NOT NULL,
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        payment_method VARCHAR(50) DEFAULT 'CASH',
        receipt_number VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS "idx_${schemaName}_supp_pay_dt" ON "${schemaName}".supplier_payments (created_at)`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".purchase_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number VARCHAR(100) NOT NULL,
        supplier_id UUID,
        supplier_name VARCHAR(255),
        invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
        total_amount DECIMAL(12, 2) NOT NULL,
        paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
        remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
        early_discount_days INT,
        early_discount_percent DECIMAL(5, 2),
        early_discount_deadline DATE,
        early_discount_amount DECIMAL(12, 2),
        early_discount_applied BOOLEAN DEFAULT FALSE,
        early_discount_applied_amount DECIMAL(12, 2) DEFAULT 0,
        notes TEXT,
        items_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS "${schemaName}".purchase_invoice_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_invoice_id UUID,
        medicine_id UUID,
        trade_name VARCHAR(255) NOT NULL,
        scientific_name VARCHAR(255),
        batch_number VARCHAR(100),
        expiry_date DATE NOT NULL,
        quantity_packs INT NOT NULL,
        units_per_pack INT NOT NULL DEFAULT 1,
        purchase_price_pack DECIMAL(12, 2) NOT NULL,
        selling_price_pack DECIMAL(12, 2) NOT NULL,
        total_cost DECIMAL(12, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
    ];

    for (const sql of statements) {
      await this.prisma.$executeRawUnsafe(sql);
    }
  }
}
