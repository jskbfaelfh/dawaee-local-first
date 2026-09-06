import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello() {
    return {
      status: 'online',
      system: 'دوائي - Dawaee Central Pharmacy Network API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  async getHealth() {
    try {
      await Promise.race([
        this.prisma.$queryRawUnsafe('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 2000)),
      ]);
      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      return {
        status: 'degraded',
        database: 'disconnected',
        message: 'Cloud database is unreachable',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
