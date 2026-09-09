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

    if (user.role === 'OWNER' && tenant.chainId) {
      const memberTenants = await this.prisma.tenant.findMany({
        where: {
          chainId: tenant.chainId,
          subscriptionStatus: { not: 'SUSPENDED' },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (memberTenants.length > 0) {
        branches = memberTenants.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          governorate: t.governorate,
          district: t.district,
          phone: t.phone,
          isCurrent: t.id === tenant.id,
        }));
      }
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

  async switchBranch(targetTenantId: string, currentTenantId: string, currentUserRole: string) {
    if (currentUserRole !== 'OWNER') {
      throw new ForbiddenException('فقط مالك الصيدلية يمتلك صلاحية التبديل بين الفروع');
    }

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

    // Fetch owner user in target tenant schema
    const targetUsers: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT id, name, username, role, is_active FROM "${targetTenant.schemaName}".users WHERE role = 'OWNER' LIMIT 1;
    `);

    const ownerUser = targetUsers[0] || {
      id: 'owner-switch',
      name: targetTenant.name,
      username: 'owner',
      role: 'OWNER',
    };

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

    // Generate new JWT
    const payload = {
      sub: ownerUser.id,
      name: ownerUser.name,
      username: ownerUser.username,
      role: 'OWNER',
      tenantId: targetTenant.id,
      schemaName: targetTenant.schemaName,
      subscriptionStatus: currentStatus,
    };

    const accessToken = this.jwtService.sign(payload);

    // Get all branches in the chain
    const memberTenants = await this.prisma.tenant.findMany({
      where: {
        chainId: targetTenant.chainId,
        subscriptionStatus: { not: 'SUSPENDED' },
      },
      orderBy: { createdAt: 'asc' },
    });

    const branches = memberTenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      governorate: t.governorate,
      district: t.district,
      phone: t.phone,
      isCurrent: t.id === targetTenant.id,
    }));

    return {
      success: true,
      message: `تم التبديل بنجاح إلى فرع (${targetTenant.name})`,
      accessToken,
      user: {
        id: ownerUser.id,
        name: ownerUser.name,
        username: ownerUser.username,
        role: 'OWNER',
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
