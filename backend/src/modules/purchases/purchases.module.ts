import { Module } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { OcrAiService } from './ocr-ai.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { PurchasesController } from './purchases.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, OcrAiService, InvoiceStorageService],
  exports: [PurchasesService, OcrAiService, InvoiceStorageService],
})
export class PurchasesModule {}
