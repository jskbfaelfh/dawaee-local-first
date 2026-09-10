import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto, AdminLoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const pharmacySlug = loginDto.pharmacySlug?.trim();
    const username = loginDto.username?.trim();
    const password = loginDto.password;

    // 1. Check Tenant in Master DB
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: pharmacySlug },
    });

    if (!tenant) {
      throw new NotFoundException('الصيدلية غير مسجلة في النظام');
    }

    if (tenant.subscriptionStatus === 'SUSPENDED') {
      throw new ForbiddenException('تم إيقاف حساب هذه الصيدلية مؤقتاً، يرجى مراجعة إدارة النظام');
    }

    // 2. Fetch User inside Tenant Schema
    const users: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, name, username, password_hash, role, is_active FROM "${tenant.schemaName}".users WHERE LOWER(TRIM(username)) = LOWER($1) LIMIT 1`,
      username,
    );

    const user = users[0];
    if (!user) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    if (!user.is_active) {
      throw new ForbiddenException('تم تعطيل حساب هذا المستخدم');
    }

    // 3. Verify Password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    // Check if subscription has expired and update status if needed
    const now = new Date();
    let currentStatus = tenant.subscriptionStatus;
    if (tenant.subscriptionEndsAt < now && tenant.subscriptionStatus === 'ACTIVE') {
      currentStatus = 'EXPIRED';
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { subscriptionStatus: 'EXPIRED' },
      });
    }

    // 4. Generate JWT
    const payload = {
      sub: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      tenantId: tenant.id,
      schemaName: tenant.schemaName,
      subscriptionStatus: currentStatus,
    };

    const accessToken = this.jwtService.sign(payload);

    // 5. Get Linked Branches for Owner
    let branches: any[] = [
      {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        governorate: tenant.governorate,
        district: tenant.district,
        phone: tenant.phone,
        isCurrent: true,
      },
    ];

    if (tenant.chainId) {
      branches = await this.getAuthorizedBranches(tenant.chainId, tenant, user);
    }

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
      pharmacy: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        governorate: tenant.governorate,
        district: tenant.district,
        phone: tenant.phone,
        subscriptionStatus: currentStatus,
        subscriptionEndsAt: tenant.subscriptionEndsAt,
      },
      branches,
    };
  }

  /**
   * Check if a user is the Master Chain Owner (HQ Owner) for a given chain.
   */
  private async isChainMasterOwner(
    chainId: string,
    currentTenant: any,
    user: { id: string; username: string; role: string; name?: string },
  ): Promise<boolean> {
    if (user.role !== 'OWNER') {
      return false;
    }

    // 1. If the user is an OWNER directly in the HQ tenant
    if (currentTenant.chainRole === 'HQ') {
      return true;
    }

    // 2. Look up the HQ tenant for this chain
    const hqTenant = await this.prisma.tenant.findFirst({
      where: {
        chainId: chainId,
        chainRole: 'HQ',
      },
    });

    if (!hqTenant) {
      // If no tenant is explicitly designated as HQ, the first created tenant is HQ
      const firstTenant = await this.prisma.tenant.findFirst({
        where: { chainId: chainId },
        orderBy: { createdAt: 'asc' },
      });
      if (firstTenant && firstTenant.id === currentTenant.id) {
        return true;
      }
      return false;
    }

    if (hqTenant.id === currentTenant.id) {
      return true;
    }

    // 3. Check if this user exists as an active OWNER in the HQ tenant's schema
    try {
      const hqOwners: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT id, username, role, is_active 
         FROM "${hqTenant.schemaName}".users 
         WHERE (id = $1::uuid OR username = $2) AND role = 'OWNER' AND is_active = TRUE
         LIMIT 1;`,
        user.id,
        user.username,
      );
      if (hqOwners.length > 0) {
        return true;
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not verify HQ owner status in schema ${hqTenant.schemaName}: ${err.message}`,
      );
    }

    return false;
  }

  /**
   * Get authorized branches for a user within a chain.
   */
  private async getAuthorizedBranches(
    chainId: string,
    currentTenant: any,
    user: { id: string; username: string; role: string; name?: string },
  ) {
    const memberTenants = await this.prisma.tenant.findMany({
      where: {
        chainId: chainId,
        subscriptionStatus: { not: 'SUSPENDED' },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (memberTenants.length === 0) {
      return [
        {
          id: currentTenant.id,
          name: currentTenant.name,
          slug: currentTenant.slug,
          governorate: currentTenant.governorate,
          district: currentTenant.district,
          phone: currentTenant.phone,
          isCurrent: true,
        },
      ];
    }

    const isMaster = await this.isChainMasterOwner(chainId, currentTenant, user);

    if (isMaster) {
      // Master owner has access to all non-suspended branches
      return memberTenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        governorate: t.governorate,
        district: t.district,
        phone: t.phone,
        isCurrent: t.id === currentTenant.id,
      }));
    }

    // For non-master users, filter branches where the user actually has an active account with matching user.id
    const authorizedBranches: any[] = [];
    for (const t of memberTenants) {
      if (t.id === currentTenant.id) {
        authorizedBranches.push({
          id: t.id,
          name: t.name,
          slug: t.slug,
          governorate: t.governorate,
          district: t.district,
          phone: t.phone,
          isCurrent: true,
        });
        continue;
      }

      try {
        const matchingUsers: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT id, role, is_active FROM "${t.schemaName}".users 
           WHERE id = $1::uuid AND is_active = TRUE
           LIMIT 1;`,
          user.id,
        );
        if (matchingUsers.length > 0) {
          authorizedBranches.push({
            id: t.id,
            name: t.name,
            slug: t.slug,
            governorate: t.governorate,
            district: t.district,
            phone: t.phone,
            isCurrent: false,
          });
        }
      } catch {
        // Schema query error, skip
      }
    }

    return authorizedBranches;
  }

  async switchBranch(targetTenantId: string, currentUser: any) {
    if (!currentUser) {
      throw new UnauthorizedException('بيانات المستخدم مفقودة');
    }

    const currentUserId = currentUser.sub || currentUser.id || currentUser.userId;
    const currentTenantId = currentUser.tenantId;

    const currentTenant = await this.prisma.tenant.findUnique({
      where: { id: currentTenantId },
    });

    if (!currentTenant) {
      throw new NotFoundException('الصيدلية الحالية غير موجودة');
    }

    const targetTenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
    });

    if (!targetTenant) {
      throw new NotFoundException('الفرع المطلوب غير موجود');
    }

    if (targetTenant.subscriptionStatus === 'SUSPENDED') {
      throw new ForbiddenException('حساب هذا الفرع موقف مؤقتاً');
    }

    // Verify both belong to the same chain
    if (
      !currentTenant.chainId ||
      !targetTenant.chainId ||
      currentTenant.chainId !== targetTenant.chainId
    ) {
      throw new ForbiddenException('الفرع المطلوب ليس مسجلاً ضمن سلسلة فروعك');
    }

    // Fetch the authentic current user (User A) from current tenant schema
    const currentDbUsers: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, name, username, password_hash, role, is_active 
       FROM "${currentTenant.schemaName}".users 
       WHERE id = $1::uuid LIMIT 1;`,
      currentUserId,
    );

    if (currentDbUsers.length === 0) {
      throw new NotFoundException('تعذر العثور على بيانات المستخدم الحالي في الصيدلية الحالية');
    }
    const userA = currentDbUsers[0];

    if (!userA.is_active) {
      throw new ForbiddenException('حسابك الحالي معطل');
    }

    // Check if current user is the Master Chain Owner (HQ Owner)
    const isMaster = await this.isChainMasterOwner(
      currentTenant.chainId,
      currentTenant,
      userA,
    );

    let effectiveRole = userA.role;

    if (isMaster) {
      // 1. Chain Master Owner (HQ):
      // The Master Owner has chain-wide authorization across all branches.
      // We ensure the exact user identity (userA.id, userA.name, userA.username) exists in target schema.
      effectiveRole = 'OWNER';

      const existingById: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT id, name, username, role, is_active 
         FROM "${targetTenant.schemaName}".users 
         WHERE id = $1::uuid LIMIT 1;`,
        userA.id,
      );

      if (existingById.length > 0) {
        // Resolve any username collision with another local row
        const conflictRow: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT id FROM "${targetTenant.schemaName}".users 
           WHERE LOWER(username) = LOWER($1) AND id != $2::uuid LIMIT 1;`,
          userA.username,
          userA.id,
        );
        if (conflictRow.length > 0) {
          const safeAlt = `${userA.username}_local_${conflictRow[0].id.slice(0, 4)}`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE "${targetTenant.schemaName}".users SET username = $1 WHERE id = $2::uuid;`,
            safeAlt,
            conflictRow[0].id,
          );
        }

        await this.prisma.$executeRawUnsafe(
          `UPDATE "${targetTenant.schemaName}".users 
           SET name = $1, username = $2, password_hash = $3, role = 'OWNER', is_active = TRUE 
           WHERE id = $4::uuid;`,
          userA.name,
          userA.username,
          userA.password_hash,
          userA.id,
        );
      } else {
        // Check if another row has the same username
        const conflictRow: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT id FROM "${targetTenant.schemaName}".users 
           WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
          userA.username,
        );
        if (conflictRow.length > 0) {
          const safeAlt = `${userA.username}_local_${conflictRow[0].id.slice(0, 4)}`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE "${targetTenant.schemaName}".users SET username = $1 WHERE id = $2::uuid;`,
            safeAlt,
            conflictRow[0].id,
          );
        }

        // Insert userA with their authentic ID and credentials
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "${targetTenant.schemaName}".users 
           (id, name, username, password_hash, role, is_active, created_at)
           VALUES ($1::uuid, $2, $3, $4, 'OWNER', TRUE, NOW());`,
          userA.id,
          userA.name,
          userA.username,
          userA.password_hash,
        );
      }
    } else {
      // 2. Non-Master User (Local staff / branch cashier / manager):
      // STRICT CHAIN MEMBERSHIP: Must already have an active account in target schema with their authentic userA.id!
      const targetExisting: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT id, name, username, role, is_active 
         FROM "${targetTenant.schemaName}".users 
         WHERE id = $1::uuid
         LIMIT 1;`,
        userA.id,
      );

      if (targetExisting.length === 0) {
        this.logger.warn(
          `Security Alert: Unauthorized branch switch attempt by user "${userA.username}" (${userA.id}) from "${currentTenant.name}" to "${targetTenant.name}" (not a chain owner and not assigned to target branch)`,
        );
        throw new ForbiddenException(
          'ليس لديك صلاحية الوصول إلى هذا الفرع. التبديل متاح فقط لمالك السلسلة (HQ) أو المستخدمين المصرح لهم في هذا الفرع',
        );
      }

      if (!targetExisting[0].is_active) {
        throw new ForbiddenException('حسابك في هذا الفرع معطل، يرجى التواصل مع إدارة الصيدلية');
      }

      effectiveRole = targetExisting[0].role;
    }

    // Check target subscription status
    const now = new Date();
    let currentStatus = targetTenant.subscriptionStatus;
    if (targetTenant.subscriptionEndsAt < now && targetTenant.subscriptionStatus === 'ACTIVE') {
      currentStatus = 'EXPIRED';
      await this.prisma.tenant.update({
        where: { id: targetTenant.id },
        data: { subscriptionStatus: 'EXPIRED' },
      });
    }

    // Target user identity is ALWAYS userA (The authentic authenticated human user!)
    const targetUser = {
      id: userA.id,
      name: userA.name,
      username: userA.username,
      role: effectiveRole,
    };

    // Generate new JWT retaining authentic user identity and role
    const payload = {
      sub: targetUser.id,
      name: targetUser.name,
      username: targetUser.username,
      role: targetUser.role,
      tenantId: targetTenant.id,
      schemaName: targetTenant.schemaName,
      subscriptionStatus: currentStatus,
    };

    const accessToken = this.jwtService.sign(payload);

    // Get list of authorized branches for this user
    const branches = await this.getAuthorizedBranches(
      targetTenant.chainId,
      targetTenant,
      targetUser,
    );

    this.logger.log(
      `Branch switched: Authentic User "${targetUser.name}" (ID: ${targetUser.id}, username: ${targetUser.username}, role: ${targetUser.role}) switched context from "${currentTenant.name}" to "${targetTenant.name}"`,
    );

    return {
      success: true,
      message: `تم التبديل بنجاح إلى فرع (${targetTenant.name})`,
      accessToken,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        username: targetUser.username,
        role: targetUser.role,
      },
      pharmacy: {
        id: targetTenant.id,
        name: targetTenant.name,
        slug: targetTenant.slug,
        governorate: targetTenant.governorate,
        district: targetTenant.district,
        phone: targetTenant.phone,
        subscriptionStatus: currentStatus,
        subscriptionEndsAt: targetTenant.subscriptionEndsAt,
      },
      branches,
    };
  }

  async adminLogin(adminLoginDto: AdminLoginDto) {
    const adminUser = this.configService.get<string>('ADMIN_USERNAME') || 'superadmin';
    const adminPass = this.configService.get<string>('ADMIN_PASSWORD') || 'Admin@Dawaee2026';

    if (
      adminLoginDto.username !== adminUser ||
      adminLoginDto.password !== adminPass
    ) {
      throw new UnauthorizedException('بيانات دخول لوحة الإدارة غير صحيحة');
    }

    const payload = {
      sub: 'super-admin-root',
      name: 'Super Admin',
      username: adminUser,
      role: 'SUPER_ADMIN',
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: 'super-admin-root',
        name: 'مدير النظام العام',
        username: adminUser,
        role: 'SUPER_ADMIN',
      },
    };
  }
}
