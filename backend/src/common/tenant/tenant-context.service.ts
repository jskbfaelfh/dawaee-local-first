import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { validateAndSanitizeSchemaName } from '../utils/security.util';

export interface TenantContextPayload {
  tenantId: string;
  schemaName: string;
  userId: string;
  role: 'OWNER' | 'CASHIER' | 'SUPER_ADMIN';
  subscriptionStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
}

@Injectable()
export class TenantContextService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<TenantContextPayload>();

  run(context: TenantContextPayload, callback: () => Promise<any>): Promise<any> {
    return this.asyncLocalStorage.run(context, callback);
  }

  getContext(): TenantContextPayload | undefined {
    return this.asyncLocalStorage.getStore();
  }

  getTenantId(): string {
    const ctx = this.getContext();
    if (!ctx) {
      throw new Error('Tenant context not found for the current request.');
    }
    return ctx.tenantId;
  }

  getSchemaName(): string {
    const ctx = this.getContext();
    if (!ctx) {
      throw new Error('Tenant schema not found for the current request.');
    }
    return validateAndSanitizeSchemaName(ctx.schemaName);
  }

  getUserRole(): string {
    const ctx = this.getContext();
    if (!ctx) {
      throw new Error('User context not found for the current request.');
    }
    return ctx.role;
  }

  isSubscriptionActive(): boolean {
    const ctx = this.getContext();
    return ctx?.subscriptionStatus === 'ACTIVE';
  }
}
