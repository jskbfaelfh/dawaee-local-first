import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method?.toUpperCase();

    const user = request.user;
    const ctx = this.tenantContext.getContext();
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

    // If subscription is EXPIRED, allow safe read operations only (Read-Only Mode)
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    // Block any mutating operations (POST, PUT, DELETE, PATCH)
    throw new ForbiddenException(
      'انتهى اشتراك الصيدلية. النظام حالياً في وضع القراءة فقط. يرجى تجديد الاشتراك للمتابعة.',
    );
  }
}
