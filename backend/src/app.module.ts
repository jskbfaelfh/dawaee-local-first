import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SearchModule } from './modules/search/search.module';
import { PosModule } from './modules/pos/pos.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ProfileModule } from './modules/profile/profile.module';
import { BackupModule } from './modules/backup/backup.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ChainModule } from './modules/chain/chain.module';
import { StocktakeModule } from './modules/stocktake/stocktake.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AuthModule,
    AdminModule,
    MedicinesModule,
    InventoryModule,
    PurchasesModule,
    ExpensesModule,
    ChainModule,
    StocktakeModule,
    SearchModule,
    PosModule,
    ReportsModule,
    ProfileModule,
    BackupModule,
    RealtimeModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 120,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionGuard,
    },
  ],
})
export class AppModule {}
