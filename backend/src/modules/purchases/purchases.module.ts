import { Module } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { OcrAiService } from './ocr-ai.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { AiUsageLimiterService } from './ai-usage-limiter.service';
import { PurchasesController } from './purchases.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, OcrAiService, InvoiceStorageService, AiUsageLimiterService],
  exports: [PurchasesService, OcrAiService, InvoiceStorageService, AiUsageLimiterService],
})
export class PurchasesModule {}
