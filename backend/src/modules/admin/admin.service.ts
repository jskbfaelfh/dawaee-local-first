import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { ProvisioningService } from './provisioning.service';
import { generateSecurePassword, isWeakPassword, sanitizeTenantResponse, encryptSecret } from '../../common/utils/security.util';
import {
  CreateTenantDto,
  UpdateTenantDto,
  UpdateSubscriptionDto,
  UpdateStatusDto,
  ResetPasswordDto,
  AddBranchDto,
  LinkTenantsDto,
  BulkChainOnboardingDto,
  MergeChainsDto,
} from './dto/create-tenant.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioningService: ProvisioningService,
  ) {}

  /**
   * Provision a brand new pharmacy with schema and owner account
   */
  async createTenant(dto: CreateTenantDto) {
    return this.provisioningService.provisionPharmacy(dto);
  }

  /**
   * Bulk Onboard a Multi-Branch Chain in 1 Step with Atomic Rollback
   */
  async onboardBulkChain(dto: BulkChainOnboardingDto) {
    if (!dto.branches || dto.branches.length === 0) {
      throw new BadRequestException('يجب تحديد فرع واحد على الأقل للسلسلة');
    }

    let chain: any = null;
    const branchesResults: any[] = [];
    const createdTenants: { id: string; schemaName: string }[] = [];

    try {
      // 1. Create the PharmacyChain master record
      chain = await this.prisma.pharmacyChain.create({
        data: {
          name: dto.chainName,
          ownerName: dto.ownerName,
          ownerPhone: dto.ownerPhone || '',
        },
      });

      // 2. Identify HQ index (if none specified, first branch is HQ)
      let hqFound = false;

      for (let i = 0; i < dto.branches.length; i++) {
        const b = dto.branches[i];
        let isHQ = b.isHQ;
        if (isHQ && !hqFound) {
          hqFound = true;
        } else if (!hqFound && i === 0) {
          isHQ = true;
          hqFound = true;
        } else {
          isHQ = false;
        }

        const branchSlug = b.slug || `${dto.ownerUsername}_b${i + 1}`;

        const tenantDto: CreateTenantDto = {
          name: b.name,
          slug: branchSlug,
          governorate: b.governorate,
          district: b.district,
          addressDetails: b.addressDetails,
          phone: b.phone || dto.ownerPhone,
          subscriptionMonths: b.subscriptionMonths,
          ownerName: dto.ownerName,
          ownerUsername: i === 0 ? dto.ownerUsername : `${dto.ownerUsername}_b${i + 1}`,
          ownerPassword: dto.ownerPassword,
          cashierCount: b.cashierCount !== undefined ? b.cashierCount : 1,
          cashierPassword: b.cashierPassword,
          chainId: chain.id,
          chainRole: isHQ ? 'HQ' : 'BRANCH',
        };

        const result = await this.provisioningService.provisionPharmacy(tenantDto);
        createdTenants.push({
          id: result.tenant.id,
          schemaName: result.tenant.schemaName,
        });

        branchesResults.push({
          ...result,
          isHQ,
        });
      }

      return {
        chain,
        ownerCredentials: {
          name: dto.ownerName,
          username: dto.ownerUsername,
          password: dto.ownerPassword,
          phone: dto.ownerPhone,
        },
        branches: branchesResults,
        message: `تم إنشاء السلسلة (${dto.chainName}) وتجهيز ${branchesResults.length} فروع بنجاح!`,
      };
    } catch (err: any) {
      this.logger.error(`Bulk onboarding failed for chain "${dto.chainName}": ${err.message}. Rolling back all created branches...`);

      // Rollback all created branches
      for (const t of createdTenants) {
        try {
          await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${t.schemaName}" CASCADE;`);
          await this.prisma.centralSearchIndex.deleteMany({ where: { tenantId: t.id } });
          await this.prisma.tenant.deleteMany({ where: { id: t.id } });
          this.logger.log(`Rolled back branch tenant "${t.id}" and schema "${t.schemaName}"`);
        } catch (rbErr: any) {
          this.logger.error(`Failed to rollback branch tenant ${t.id}: ${rbErr.message}`);
        }
      }

      // Rollback chain record
      if (chain?.id) {
        try {
          await this.prisma.pharmacyChain.deleteMany({ where: { id: chain.id } });
          this.logger.log(`Rolled back chain record "${chain.id}"`);
        } catch (chainRbErr: any) {
          this.logger.error(`Failed to rollback chain ${chain.id}: ${chainRbErr.message}`);
        }
      }

      throw new BadRequestException(`فشلت عملية تهيئة السلسلة الجماعية: ${err.message}. تم التراجع عن كافة الفروع المنشأة بنجاح.`);
    }
  }

  /**
   * Merge Multiple Existing Pharmacies into a Chain
   */
  async mergeExistingIntoChain(dto: MergeChainsDto) {
    const hqTenant = await this.prisma.tenant.findUnique({
      where: { id: dto.hqTenantId },
    });

    if (!hqTenant) {
      throw new NotFoundException('الصيدلية الرئيسية المحددة غير موجودة');
    }

    // Create PharmacyChain
    const chain = await this.prisma.pharmacyChain.create({
      data: {
        name: dto.chainName,
        ownerName: hqTenant.name,
        ownerPhone: hqTenant.phone,
      },
    });

    // Update HQ Tenant
    await this.prisma.tenant.update({
      where: { id: hqTenant.id },
      data: {
        chainId: chain.id,
        chainRole: 'HQ',
      },
    });

    // Update Branch Tenants
    const branchIds = dto.branchTenantIds.filter((id) => id !== dto.hqTenantId);
    for (const bId of branchIds) {
      await this.prisma.tenant.update({
        where: { id: bId },
        data: {
          chainId: chain.id,
          chainRole: 'BRANCH',
        },
      });
    }

    return {
      success: true,
      message: `تم دمج ${branchIds.length + 1} صيدليات في سلسلة (${dto.chainName}) بنجاح!`,
      chain,
    };
  }

  /**
   * Add a secondary branch to an existing pharmacy tenant
   */
  async addBranchToTenant(parentTenantId: string, dto: AddBranchDto) {
    const parentTenant = await this.getTenantById(parentTenantId);

    // 1. Ensure or create a PharmacyChain for the parent
    let chainId = parentTenant.chainId;

    if (!chainId) {
      const newChain = await this.prisma.pharmacyChain.create({
        data: {
          name: `مجموعة ${parentTenant.name}`,
          ownerName: parentTenant.name,
          ownerPhone: parentTenant.phone,
        },
      });
      chainId = newChain.id;

      // Set parent as HQ
      await this.prisma.tenant.update({
        where: { id: parentTenant.id },
        data: {
          chainId: newChain.id,
          chainRole: 'HQ',
        },
      });
    }

    // 2. Fetch parent owner user info if not explicitly provided
    let ownerName = dto.ownerName;
    let ownerUsername = dto.ownerUsername;
    let ownerPassword = dto.ownerPassword;

    if (!ownerUsername || !ownerPassword) {
      try {
        const ownerUsers: any[] = await this.prisma.$queryRawUnsafe(`
          SELECT name, username FROM "${parentTenant.schemaName}".users WHERE role = 'OWNER' LIMIT 1;
        `);
        if (ownerUsers.length > 0) {
          ownerName = ownerName || ownerUsers[0].name;
          ownerUsername = ownerUsername || `${ownerUsers[0].username}_${dto.slug || Date.now().toString().slice(-4)}`;
        }
      } catch (e) {
        this.logger.warn(`Could not fetch parent owner info: ${e.message}`);
      }
    }

    const finalOwnerName: string = ownerName || parentTenant.name || 'مدير الفرع';
    const finalOwnerUsername: string = ownerUsername || `owner_${dto.slug || Date.now().toString().slice(-4)}`;
    const finalOwnerPassword: string = ownerPassword || generateSecurePassword(14, 'BrOwn-');

    // 3. Provision new tenant as a BRANCH of this chain
    const createDto: CreateTenantDto = {
      name: dto.name,
      slug: dto.slug,
      governorate: dto.governorate,
      district: dto.district,
      addressDetails: dto.addressDetails,
      phone: dto.phone || parentTenant.phone,
      subscriptionMonths: dto.subscriptionMonths,
      ownerName: finalOwnerName,
      ownerUsername: finalOwnerUsername,
      ownerPassword: finalOwnerPassword,
      cashierCount: dto.cashierCount !== undefined ? dto.cashierCount : 1,
      cashierPassword: dto.cashierPassword,
      chainId,
      chainRole: 'BRANCH',
    };

    return this.provisioningService.provisionPharmacy(createDto);
  }

  /**
   * Link multiple existing pharmacies into a single chain
   */
  async linkTenantsIntoChain(dto: LinkTenantsDto) {
    if (!dto.tenantIds || dto.tenantIds.length < 2) {
      throw new Error('يجب تحديد صيدليتين على الأقل لربطهما في سلسلة');
    }

    const firstTenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantIds[0] },
    });

    if (!firstTenant) {
      throw new NotFoundException('الصيدلية الرئيسية غير موجودة');
    }

    // Create Chain
    const chain = await this.prisma.pharmacyChain.create({
      data: {
        name: dto.chainName,
        ownerName: firstTenant.name,
        ownerPhone: firstTenant.phone,
      },
    });

    // Update first tenant as HQ
    await this.prisma.tenant.update({
      where: { id: firstTenant.id },
      data: {
        chainId: chain.id,
        chainRole: 'HQ',
      },
    });

    // Update remaining tenants as BRANCH
    for (let i = 1; i < dto.tenantIds.length; i++) {
      await this.prisma.tenant.update({
        where: { id: dto.tenantIds[i] },
        data: {
          chainId: chain.id,
          chainRole: 'BRANCH',
        },
      });
    }

    return {
      success: true,
      message: `تم ربط ${dto.tenantIds.length} صيدليات بنجاح في (${dto.chainName})`,
      chain,
    };
  }

  /**
   * List all pharmacies with filtering and counts
   */
  async getAllTenants(query?: { status?: string; search?: string }) {
    const where: any = {};

    if (query?.status) {
      where.subscriptionStatus = query.status;
    }

    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { governorate: { contains: query.search, mode: 'insensitive' } },
        { district: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const tenants = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        chain: true,
        _count: {
          select: { searchIndexes: true },
        },
      },
    });

    return tenants.map((t) => sanitizeTenantResponse(t));
  }

  /**
   * Get single pharmacy details
   */
  async getTenantById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { searchIndexes: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('الصيدلية غير موجودة');
    }

    return sanitizeTenantResponse(tenant);
  }

  /**
   * Get all users/accounts for a specific pharmacy (Owner, Cashier)
   * Auto-provisions schema and default accounts if pharmacy was seeded without full schema.
   */
  async getTenantUsers(tenantId: string) {
    const tenant = await this.getTenantById(tenantId);

    try {
      // 1. Check if the schema and users table exist
      const checkTable: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT to_regclass('"${tenant.schemaName}".users')::text as table_exists;
      `);

      if (!checkTable[0] || !checkTable[0].table_exists) {
        // Auto-provision schema on demand
        await this.provisioningService.createTenantSchemaAndTables(tenant.schemaName);

        // Create emergency owner and cashier with securely generated random passwords
        const initialOwnerPassword = generateSecurePassword(14, 'Own-');
        const initialCashierPassword = generateSecurePassword(12, 'Pos-');
        const ownerPasswordHash = await bcrypt.hash(initialOwnerPassword, 10);
        const cashierPasswordHash = await bcrypt.hash(initialCashierPassword, 10);
        const ownerUserId = crypto.randomUUID();
        const cashierUserId = crypto.randomUUID();

        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "${tenant.schemaName}".users (id, name, username, password_hash, role, is_active, created_at)
           VALUES 
             ($1::uuid, $2, $3, $4, 'OWNER', TRUE, NOW()),
             ($5::uuid, $6, $7, $8, 'CASHIER', TRUE, NOW())
           ON CONFLICT (username) DO NOTHING;`,
          ownerUserId,
          `المالك - ${tenant.name}`,
          tenant.slug,
          ownerPasswordHash,
          cashierUserId,
          `كاشير - ${tenant.name}`,
          `${tenant.slug}_pos`,
          cashierPasswordHash,
        );

        this.logger.warn(`Security: Auto-provisioned missing credentials for tenant ${tenant.slug} with secure random passwords.`);
      }

      const users: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT id, name, username, role, is_active, created_at
        FROM "${tenant.schemaName}".users
        ORDER BY role ASC, created_at ASC;
      `);

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        users,
      };
    } catch (err: any) {
      this.logger.error(`Error retrieving users for tenant ${tenant.slug}: ${err.message}`);
      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        users: [],
      };
    }
  }

  /**
   * Reset/change password for any user inside a pharmacy tenant
   */
  async resetTenantUserPassword(tenantId: string, userId: string, dto: ResetPasswordDto) {
    const weakCheck = isWeakPassword(dto.newPassword);
    if (weakCheck.isWeak) {
      throw new BadRequestException(weakCheck.reason || 'كلمة المرور الجديدة ضعيفة جداً');
    }

    const tenant = await this.getTenantById(tenantId);

    // Ensure table exists
    const checkTable: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT to_regclass('"${tenant.schemaName}".users')::text as table_exists;
    `);

    if (!checkTable[0] || !checkTable[0].table_exists) {
      await this.provisioningService.createTenantSchemaAndTables(tenant.schemaName);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    const updated = await this.prisma.$executeRawUnsafe(`
      UPDATE "${tenant.schemaName}".users
      SET password_hash = $1
      WHERE id = $2::uuid;
    `, passwordHash, userId);

    if (!updated) {
      throw new NotFoundException('المستخدم غير موجود داخل هذه الصيدلية');
    }

    this.logger.log(`Password reset for user ${userId} in tenant ${tenant.slug}`);

    return {
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح',
    };
  }

  /**
   * Update pharmacy info (Name, locations, phone, status, expiry)
   */
  async updateTenant(id: string, dto: UpdateTenantDto) {
    const tenant = await this.getTenantById(id);

    const updateData: any = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.governorate) updateData.governorate = dto.governorate;
    if (dto.district) updateData.district = dto.district;
    if (dto.addressDetails !== undefined) updateData.addressDetails = dto.addressDetails;
    if (dto.googleMapsUrl !== undefined) updateData.googleMapsUrl = dto.googleMapsUrl;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.subscriptionStatus) updateData.subscriptionStatus = dto.subscriptionStatus;
    if (dto.subscriptionEndsAt) updateData.subscriptionEndsAt = new Date(dto.subscriptionEndsAt);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: updateData,
    });

    // Sync updated info with CentralSearchIndex
    await this.prisma.centralSearchIndex.updateMany({
      where: { tenantId: id },
      data: {
        pharmacyName: updated.name,
        governorate: updated.governorate,
        district: updated.district,
        addressDetails: updated.addressDetails,
        googleMapsUrl: updated.googleMapsUrl,
        phone: updated.phone,
      },
    });

    this.logger.log(`Tenant ${id} (${updated.name}) updated successfully.`);
    return sanitizeTenantResponse(updated);
  }

  /**
   * Delete pharmacy tenant, drops its PostgreSQL schema & search index completely
   */
  async deleteTenant(id: string) {
    const tenant = await this.getTenantById(id);

    this.logger.warn(`Deleting tenant ${id} (${tenant.name}) and dropping schema "${tenant.schemaName}"...`);

    // 1. Drop tenant PostgreSQL schema and all its tables
    await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${tenant.schemaName}" CASCADE;`);

    // 2. Delete all records from CentralSearchIndex
    await this.prisma.centralSearchIndex.deleteMany({
      where: { tenantId: id },
    });

    // 3. Delete Tenant Master record
    await this.prisma.tenant.delete({
      where: { id },
    });

    this.logger.log(`Tenant ${id} and schema "${tenant.schemaName}" deleted successfully.`);

    return {
      success: true,
      message: `تم حذف صيدلية (${tenant.name}) وقاعدة بياناتها بالكامل بنجاح`,
    };
  }

  /**
   * Extend or renew subscription
   */
  async extendSubscription(id: string, dto: UpdateSubscriptionDto) {
    const tenant = await this.getTenantById(id);

    const currentEnd = new Date(tenant.subscriptionEndsAt);
    const now = new Date();
    // If already expired, start from now, otherwise add to existing end date
    const baseDate = currentEnd > now ? currentEnd : now;
    baseDate.setMonth(baseDate.getMonth() + dto.extendMonths);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        subscriptionEndsAt: baseDate,
        subscriptionStatus: 'ACTIVE',
      },
    });

    return updated;
  }

  /**
   * Update tenant status (ACTIVE, EXPIRED, SUSPENDED)
   */
  async updateTenantStatus(id: string, dto: UpdateStatusDto) {
    await this.getTenantById(id);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        subscriptionStatus: dto.status as any,
      },
    });

    return updated;
  }

  private static dashboardCache: { data: any; expiry: number } | null = null;

  /**
   * Super Admin Dashboard Overview Metrics (Aggregated Single-Query & In-Memory Cache)
   */
  async getDashboardMetrics() {
    const now = Date.now();
    if (AdminService.dashboardCache && AdminService.dashboardCache.expiry > now) {
      return AdminService.dashboardCache.data;
    }

    const [tenantStats, totalMedicines, totalIndexedStock] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE subscription_status = 'ACTIVE')::int as active,
          COUNT(*) FILTER (WHERE subscription_status = 'EXPIRED')::int as expired,
          COUNT(*) FILTER (WHERE subscription_status = 'SUSPENDED')::int as suspended
        FROM tenants;
      `),
      this.prisma.medicine.count(),
      this.prisma.centralSearchIndex.count({ where: { isAvailable: true } }),
    ]);

    const stats = tenantStats[0] || {};
    const result = {
      tenants: {
        total: Number(stats.total || 0),
        active: Number(stats.active || 0),
        expired: Number(stats.expired || 0),
        suspended: Number(stats.suspended || 0),
      },
      catalog: {
        totalMedicines,
        totalActiveSearchItems: totalIndexedStock,
      },
    };

    AdminService.dashboardCache = {
      data: result,
      expiry: now + 15000, // 15 seconds cache
    };

    return result;
  }

  /**
   * Configure Cloudflare R2 bucket credentials for a specific tenant
   */
  async updateTenantR2Config(
    id: string,
    dto: {
      r2BucketName?: string;
      r2AccountId?: string;
      r2AccessKeyId?: string;
      r2SecretAccessKey?: string;
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('الصيدلية غير موجودة');
    }

    const data: any = {};
    if (dto.r2BucketName !== undefined) {
      data.r2BucketName = dto.r2BucketName ? dto.r2BucketName.trim() : null;
    }

    const rawAccount = (dto.r2AccountId || '').trim();
    if (rawAccount && !rawAccount.startsWith('•••') && !rawAccount.includes('••••')) {
      data.r2AccountId = encryptSecret(rawAccount);
    } else if (dto.r2AccountId === null || dto.r2AccountId === '') {
      data.r2AccountId = null;
    }

    const rawAccessKey = (dto.r2AccessKeyId || '').trim();
    if (rawAccessKey && !rawAccessKey.startsWith('•••') && !rawAccessKey.includes('••••')) {
      data.r2AccessKeyId = encryptSecret(rawAccessKey);
    } else if (dto.r2AccessKeyId === null || dto.r2AccessKeyId === '') {
      data.r2AccessKeyId = null;
    }

    const rawSecret = (dto.r2SecretAccessKey || '').trim();
    if (rawSecret && !rawSecret.startsWith('•••') && !rawSecret.includes('••••')) {
      data.r2SecretAccessKey = encryptSecret(rawSecret);
    } else if (dto.r2SecretAccessKey === null || dto.r2SecretAccessKey === '') {
      data.r2SecretAccessKey = null;
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    return sanitizeTenantResponse(updated);
  }
}
