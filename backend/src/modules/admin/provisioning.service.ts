import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { TenantMigrationService } from '../../database/migrations/tenant-migration.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { generateSecurePassword, isWeakPassword, sanitizeTenantResponse } from '../../common/utils/security.util';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantMigrationService: TenantMigrationService,
  ) {}

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
   * Execution to create all tenant tables using versioned Tenant Migration Service
   */
  public async createTenantSchemaAndTables(schemaName: string): Promise<void> {
    await this.tenantMigrationService.migrateSingleTenant(schemaName);
  }
}
