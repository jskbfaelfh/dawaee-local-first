import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Connected to PostgreSQL database successfully.');
        return;
      } catch (error) {
        if (attempt < 4) {
          this.logger.warn(`Database connection attempt ${attempt} failed. Retrying in 2s (waking Neon compute)...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          this.logger.error('Failed to connect to database after retries', error);
        }
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL database.');
  }

  /**
   * Run a raw query or operation inside a specific tenant schema
   */
  async executeInTenantSchema<T>(
    schemaName: string,
    operation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // Set the search_path to the tenant schema first, fallback to public for master tables
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public;`);
      return operation(tx as unknown as PrismaClient);
    });
  }
}
