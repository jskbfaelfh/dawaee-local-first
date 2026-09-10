import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface AiUsageMetrics {
  userRequestsThisMinute: number;
  userRequestsToday: number;
  tenantRequestsThisMinute: number;
  tenantRequestsToday: number;
  tenantRequestsThisMonth: number;
  tenantDailyLimit: number;
  tenantMonthlyLimit: number;
  userRpmLimit: number;
  tenantRpmLimit: number;
  userDailyLimit: number;
}

@Injectable()
export class AiUsageLimiterService {
  private readonly logger = new Logger(AiUsageLimiterService.name);

  // Configuration Quotas (configurable via environment variables or sensible production defaults)
  public static readonly USER_RPM_LIMIT = parseInt(process.env.AI_USER_RPM_LIMIT || '5', 10);
  public static readonly TENANT_RPM_LIMIT = parseInt(process.env.AI_TENANT_RPM_LIMIT || '15', 10);
  public static readonly USER_DAILY_LIMIT = parseInt(process.env.AI_USER_DAILY_LIMIT || '50', 10);
  public static readonly TENANT_DAILY_LIMIT = parseInt(process.env.AI_TENANT_DAILY_LIMIT || '150', 10);
  public static readonly TENANT_MONTHLY_LIMIT = parseInt(process.env.AI_TENANT_MONTHLY_LIMIT || '2000', 10);

  // In-memory sliding window timestamps for RPM (Requests Per Minute)
  private readonly userTimestamps = new Map<string, number[]>();
  private readonly tenantTimestamps = new Map<string, number[]>();

  // In-memory day/month counters
  // Key format: tenant:{tenantId}:day:{YYYY-MM-DD}, tenant:{tenantId}:month:{YYYY-MM}
  // Key format: user:{userId}:day:{YYYY-MM-DD}
  private readonly usageCounters = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {
    // Periodic cleanup of stale sliding-window memory every 10 minutes
    setInterval(() => this.cleanupStaleMemory(), 10 * 60 * 1000);
  }

  private getCurrentDateKey(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private getCurrentMonthKey(): string {
    return new Date().toISOString().slice(0, 7); // YYYY-MM
  }

  private cleanupStaleMemory(): void {
    const oneMinuteAgo = Date.now() - 60000;
    for (const [key, times] of this.userTimestamps.entries()) {
      const filtered = times.filter((t) => t > oneMinuteAgo);
      if (filtered.length === 0) {
        this.userTimestamps.delete(key);
      } else {
        this.userTimestamps.set(key, filtered);
      }
    }
    for (const [key, times] of this.tenantTimestamps.entries()) {
      const filtered = times.filter((t) => t > oneMinuteAgo);
      if (filtered.length === 0) {
        this.tenantTimestamps.delete(key);
      } else {
        this.tenantTimestamps.set(key, filtered);
      }
    }
  }

  /**
   * Check and consume AI scan quota.
   * Throws HTTP 429 TooManyRequests if any limit is exceeded.
   */
  public async checkAndConsumeQuota(
    tenantId: string,
    userId: string,
    userName?: string,
  ): Promise<{ remainingDaily: number; remainingMonthly: number }> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const dateKey = this.getCurrentDateKey();
    const monthKey = this.getCurrentMonthKey();

    // 1. Check User RPM (Requests Per Minute)
    const userTimes = (this.userTimestamps.get(userId) || []).filter((t) => t > oneMinuteAgo);
    if (userTimes.length >= AiUsageLimiterService.USER_RPM_LIMIT) {
      this.logger.warn(`AI User RPM exceeded: User ${userName || userId} in Tenant ${tenantId}`);
      throw new HttpException(
        `تم تجاوز حد السرعة المسموح به لطلبات الذكاء الاصطناعي للمستخدم (${AiUsageLimiterService.USER_RPM_LIMIT} طلبات في الدقيقة). يرجى الانتظار بضع ثوانٍ قبل إعادة المحاولة.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Check Pharmacy (Tenant) RPM
    const tenantTimes = (this.tenantTimestamps.get(tenantId) || []).filter((t) => t > oneMinuteAgo);
    if (tenantTimes.length >= AiUsageLimiterService.TENANT_RPM_LIMIT) {
      this.logger.warn(`AI Tenant RPM exceeded: Tenant ${tenantId}`);
      throw new HttpException(
        `تم تجاوز حد السرعة المسموح به لطلبات الذكاء الاصطناعي للصيدلية (${AiUsageLimiterService.TENANT_RPM_LIMIT} طلباً في الدقيقة). يرجى الانتظار قليلاً.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 3. Check User Daily Limit
    const userDayKey = `user:${userId}:day:${dateKey}`;
    const userDayCount = this.usageCounters.get(userDayKey) || 0;
    if (userDayCount >= AiUsageLimiterService.USER_DAILY_LIMIT) {
      throw new HttpException(
        `تم استهلاك الحد اليومي المسموح به لطلبات الذكاء الاصطناعي لحسابك (${AiUsageLimiterService.USER_DAILY_LIMIT} فاتورة يومياً). يتجدد الرصيد غداً.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 4. Check Pharmacy Daily Limit
    const tenantDayKey = `tenant:${tenantId}:day:${dateKey}`;
    const tenantDayCount = this.usageCounters.get(tenantDayKey) || 0;
    if (tenantDayCount >= AiUsageLimiterService.TENANT_DAILY_LIMIT) {
      this.logger.warn(`AI Tenant Daily Quota reached: Tenant ${tenantId}`);
      throw new HttpException(
        `تم استهلاك كامل الرصيد اليومي المخصص لقراءة الفواتير بالذكاء الاصطناعي لهذه الصيدلية (${AiUsageLimiterService.TENANT_DAILY_LIMIT} فاتورة يومياً). يتجدد الرصيد عند منتصف الليل.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 5. Check Pharmacy Monthly Limit
    const tenantMonthKey = `tenant:${tenantId}:month:${monthKey}`;
    const tenantMonthCount = this.usageCounters.get(tenantMonthKey) || 0;
    if (tenantMonthCount >= AiUsageLimiterService.TENANT_MONTHLY_LIMIT) {
      this.logger.warn(`AI Tenant Monthly Quota reached: Tenant ${tenantId}`);
      throw new HttpException(
        `تم استهلاك كامل الرصيد الشهري المخصص لقراءة الفواتير بالذكاء الاصطناعي لهذه الصيدلية (${AiUsageLimiterService.TENANT_MONTHLY_LIMIT} فاتورة شهرياً).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Consume Quotas
    userTimes.push(now);
    this.userTimestamps.set(userId, userTimes);

    tenantTimes.push(now);
    this.tenantTimestamps.set(tenantId, tenantTimes);

    this.usageCounters.set(userDayKey, userDayCount + 1);
    this.usageCounters.set(tenantDayKey, tenantDayCount + 1);
    this.usageCounters.set(tenantMonthKey, tenantMonthCount + 1);

    const remainingDaily = AiUsageLimiterService.TENANT_DAILY_LIMIT - (tenantDayCount + 1);
    const remainingMonthly = AiUsageLimiterService.TENANT_MONTHLY_LIMIT - (tenantMonthCount + 1);

    this.logger.log(
      `AI Request Approved for Tenant [${tenantId}], User [${userName || userId}]. Remaining today: ${remainingDaily}, this month: ${remainingMonthly}`,
    );

    return { remainingDaily, remainingMonthly };
  }

  /**
   * Get current usage metrics and limits for the tenant and user.
   */
  public getUsageMetrics(tenantId: string, userId: string): AiUsageMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const dateKey = this.getCurrentDateKey();
    const monthKey = this.getCurrentMonthKey();

    const userTimes = (this.userTimestamps.get(userId) || []).filter((t) => t > oneMinuteAgo);
    const tenantTimes = (this.tenantTimestamps.get(tenantId) || []).filter((t) => t > oneMinuteAgo);

    return {
      userRequestsThisMinute: userTimes.length,
      userRequestsToday: this.usageCounters.get(`user:${userId}:day:${dateKey}`) || 0,
      tenantRequestsThisMinute: tenantTimes.length,
      tenantRequestsToday: this.usageCounters.get(`tenant:${tenantId}:day:${dateKey}`) || 0,
      tenantRequestsThisMonth: this.usageCounters.get(`tenant:${tenantId}:month:${monthKey}`) || 0,
      tenantDailyLimit: AiUsageLimiterService.TENANT_DAILY_LIMIT,
      tenantMonthlyLimit: AiUsageLimiterService.TENANT_MONTHLY_LIMIT,
      userRpmLimit: AiUsageLimiterService.USER_RPM_LIMIT,
      tenantRpmLimit: AiUsageLimiterService.TENANT_RPM_LIMIT,
      userDailyLimit: AiUsageLimiterService.USER_DAILY_LIMIT,
    };
  }
}
