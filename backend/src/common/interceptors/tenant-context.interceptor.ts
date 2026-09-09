import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService, TenantContextPayload } from '../tenant/tenant-context.service';
import { validateAndSanitizeSchemaName } from '../utils/security.util';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContextService: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.tenantId && user.schemaName) {
      const sanitizedSchema = validateAndSanitizeSchemaName(user.schemaName);
      const payload: TenantContextPayload = {
        tenantId: user.tenantId,
        schemaName: sanitizedSchema,
        userId: user.sub,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus || 'ACTIVE',
      };

      return new Observable((subscriber) => {
        this.tenantContextService.run(payload, async () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        });
      });
    }

    return next.handle();
  }
}
