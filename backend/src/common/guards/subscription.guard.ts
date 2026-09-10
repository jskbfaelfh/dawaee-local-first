import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../tenant/tenant-context.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const method = request.method?.toUpperCase();
    const url = request.url || '';

    let user = request.user;
    const ctx = this.tenantContext.getContext();

    // Fallback token extraction if user is not yet populated
    if (!user) {
      try {
        const authHeader = request.headers?.authorization;
        const cookieToken = request.cookies?.dawaee_token;
        const rawToken = authHeader?.startsWith('Bearer ')
          ? authHeader.substring(7)
          : cookieToken;
        if (rawToken) {
          const parts = rawToken.split('.');
          if (parts.length === 3) {
            const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
            user = JSON.parse(payloadJson);
          }
        }
      } catch {}
    }

    const subscriptionStatus = user?.subscriptionStatus || ctx?.subscriptionStatus;

    if (!subscriptionStatus) {
      return true; // If no user or tenant context (e.g. public or super admin), allow
    }

    // If subscription is ACTIVE, allow everything
    if (subscriptionStatus === 'ACTIVE') {
      return true;
    }

    // If tenant account is SUSPENDED, block all access completely
    if (subscriptionStatus === 'SUSPENDED') {
      throw new ForbiddenException('تم إيقاف حساب هذه الصيدلية مؤقتاً، يرجى مراجعة إدارة النظام');
    }

    // If subscription is EXPIRED:
    // Block AI smart search or heavy AI features even on GET/POST
    if (url.includes('/ai-smart-search') || url.includes('/ocr-extract') || url.includes('/ocr-match')) {
      throw new ForbiddenException(
        'انتهى اشتراك الصيدلية. ميزات الذكاء الاصطناعي معطلة حتى تجديد الاشتراك.',
      );
    }

    // Allow safe read operations only (Read-Only Mode)
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    // Block any mutating operations (POST, PUT, DELETE, PATCH)
    throw new ForbiddenException(
      'انتهى اشتراك الصيدلية. النظام حالياً في وضع القراءة فقط. يرجى تجديد الاشتراك للمتابعة.',
    );
  }
}
