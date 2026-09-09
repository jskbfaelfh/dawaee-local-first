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

    // For non-master users, filter branches where the user actually has an active account
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
           WHERE (id = $1::uuid OR username = $2) AND is_active = TRUE
           LIMIT 1;`,
          user.id,
          user.username,
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

    // Fetch the actual current user (User A) from current tenant schema
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

    let targetUser: { id: string; name: string; username: string; role: string };

    if (isMaster) {
      // 1. Chain Master Owner: Authorized across all branches in the chain
      // Maintain user's exact identity in target schema
      const targetUsersById: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT id, name, username, role, is_active 
         FROM "${targetTenant.schemaName}".users 
         WHERE id = $1::uuid LIMIT 1;`,
        userA.id,
      );

      if (targetUsersById.length > 0) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "${targetTenant.schemaName}".users 
           SET name = $1, role = 'OWNER', is_active = TRUE 
           WHERE id = $2::uuid;`,
          userA.name,
          userA.id,
        );
        targetUser = {
          id: userA.id,
          name: userA.name,
          username: targetUsersById[0].username,
          role: 'OWNER',
        };
      } else {
        const targetUsersByUsername: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT id, name, username, role, is_active 
           FROM "${targetTenant.schemaName}".users 
           WHERE username = $1 LIMIT 1;`,
          userA.username,
        );

        if (targetUsersByUsername.length > 0) {
          if (targetUsersByUsername[0].role === 'OWNER') {
            await this.prisma.$executeRawUnsafe(
              `UPDATE "${targetTenant.schemaName}".users 
               SET name = $1, role = 'OWNER', is_active = TRUE 
               WHERE id = $2::uuid;`,
              userA.name,
              targetUsersByUsername[0].id,
            );
            targetUser = {
              id: targetUsersByUsername[0].id,
              name: userA.name,
              username: targetUsersByUsername[0].username,
              role: 'OWNER',
            };
          } else {
            const distinctUsername = `${userA.username}_chain`;
            await this.prisma.$executeRawUnsafe(
              `INSERT INTO "${targetTenant.schemaName}".users 
               (id, name, username, password_hash, role, is_active, created_at)
               VALUES ($1::uuid, $2, $3, $4, 'OWNER', TRUE, NOW());`,
              userA.id,
              userA.name,
              distinctUsername,
              userA.password_hash,
            );
            targetUser = {
              id: userA.id,
              name: userA.name,
              username: distinctUsername,
              role: 'OWNER',
            };
          }
        } else {
          // Provision Chain Master Owner into the branch schema
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "${targetTenant.schemaName}".users 
             (id, name, username, password_hash, role, is_active, created_at)
             VALUES ($1::uuid, $2, $3, $4, 'OWNER', TRUE, NOW());`,
            userA.id,
            userA.name,
            userA.username,
            userA.password_hash,
          );
          targetUser = {
            id: userA.id,
            name: userA.name,
            username: userA.username,
            role: 'OWNER',
          };
        }
      }
    } else {
      // 2. Non-Master User (Local branch user / manager):
      // STRICT AUTHORIZATION: Must already exist and be active in target schema!
      const targetExisting: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT id, name, username, role, is_active 
         FROM "${targetTenant.schemaName}".users 
         WHERE (id = $1::uuid OR username = $2)
         LIMIT 1;`,
        userA.id,
        userA.username,
      );

      if (targetExisting.length === 0) {
        this.logger.warn(
          `Security Alert: Unauthorized branch switch attempt by user "${userA.username}" from "${currentTenant.name}" to "${targetTenant.name}" (not assigned to target branch)`,
        );
        throw new ForbiddenException(
          'ليس لديك صلاحية الوصول إلى هذا الفرع. التبديل متاح فقط لمالك السلسلة (HQ) أو المستخدمين المصرح لهم في هذا الفرع',
        );
      }

      if (!targetExisting[0].is_active) {
        throw new ForbiddenException('حسابك في هذا الفرع معطل، يرجى التواصل مع إدارة الصيدلية');
      }

      targetUser = {
        id: targetExisting[0].id,
        name: targetExisting[0].name,
        username: targetExisting[0].username,
        role: targetExisting[0].role,
      };
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
      `Branch switched: User "${targetUser.name}" (${targetUser.username}, role: ${targetUser.role}) switched from branch "${currentTenant.name}" to "${targetTenant.name}"`,
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
    const adminUser = this.configService.get<string>('ADMIN_USERNAME');
    const adminPass = this.configService.get<string>('ADMIN_PASSWORD');

    // Fail-closed: Super Admin login must be explicitly configured in environment variables
    if (!adminUser || !adminPass) {
      this.logger.error('CRITICAL: ADMIN_USERNAME or ADMIN_PASSWORD environment variable is not configured.');
      throw new UnauthorizedException('تسجيل الدخول كمدير عام غير مهيأ حالياً. يرجى تعيين متغيرات البيئة على السيرفر.');
    }

    // In production, strictly disallow the leaked default GitHub password
    if (process.env.NODE_ENV === 'production' && (adminPass === 'Admin@Dawaee2026' || adminPass.length < 10)) {
      this.logger.error('CRITICAL SECURITY: Insecure or default ADMIN_PASSWORD blocked in production.');
      throw new UnauthorizedException('تم حظر الدخول: كلمة المرور الافتراضية محظورة في بيئة الإنتاج.');
    }

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
