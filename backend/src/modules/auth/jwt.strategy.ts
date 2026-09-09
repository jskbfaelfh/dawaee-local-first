import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { getOrGenerateDevJwtSecret } from '../../common/utils/security.util';

export interface JwtPayload {
  sub: string;
  name: string;
  username: string;
  role: 'OWNER' | 'CASHIER' | 'SUPER_ADMIN';
  tenantId?: string;
  schemaName?: string;
  subscriptionStatus?: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET') || getOrGenerateDevJwtSecret();
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: any) => {
          if (req && req.cookies && req.cookies.dawaee_token) {
            return req.cookies.dawaee_token;
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('جلسة الدخول غير صالحة');
    }

    // 1. Super Admin authorization
    if (payload.role === 'SUPER_ADMIN') {
      return payload;
    }

    // 2. Tenant Pharmacy verification
    if (!payload.tenantId) {
      throw new UnauthorizedException('بيانات الصيدلية مفقودة في الجلسة');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: {
        id: true,
        name: true,
        schemaName: true,
        subscriptionStatus: true,
      },
    });

    if (!tenant) {
      throw new UnauthorizedException('الصيدلية غير مسجلة أو تم حذفها من النظام');
    }

    if (tenant.subscriptionStatus !== 'ACTIVE') {
      throw new UnauthorizedException('اشتراك الصيدلية منتهي أو معلق، يرجى مراجعة إدارة دوائي');
    }

    // 3. User account active verification inside isolated tenant schema
    const schemaName = tenant.schemaName || payload.schemaName;
    try {
      const userRecords: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT id, name, username, role, is_active FROM "${schemaName}".users WHERE id = $1::uuid LIMIT 1`,
        payload.sub,
      );

      if (!userRecords || userRecords.length === 0) {
        throw new UnauthorizedException('المستخدم غير موجود داخل قاعدة بيانات الصيدلية');
      }

      const dbUser = userRecords[0];
      if (!dbUser.is_active) {
        throw new UnauthorizedException('تم تعطيل هذا الحساب، يرجى مراجعة إدارة الصيدلية');
      }

      // Sync role and schema from DB to prevent token privilege tampering
      return {
        ...payload,
        name: dbUser.name,
        role: dbUser.role,
        schemaName: tenant.schemaName,
        subscriptionStatus: tenant.subscriptionStatus,
      };
    } catch (err: any) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`Error validating user session for ${payload.username}: ${err.message}`);
      throw new UnauthorizedException('تعذر التحقق من صلاحية الجلسة، يرجى إعادة تسجيل الدخول');
    }
  }
}
