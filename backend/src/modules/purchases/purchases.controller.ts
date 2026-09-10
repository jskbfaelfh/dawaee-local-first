import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PurchasesService } from './purchases.service';
import { OcrAiService } from './ocr-ai.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { AiUsageLimiterService } from './ai-usage-limiter.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Controller('purchases')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
@Roles('OWNER', 'SUPER_ADMIN')
export class PurchasesController {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly ocrAiService: OcrAiService,
    private readonly invoiceStorageService: InvoiceStorageService,
    private readonly aiUsageLimiterService: AiUsageLimiterService,
  ) {}

  /**
   * Dedicated endpoint to upload and securely validate invoice images
   * Validates MIME type, max 10MB size, and file magic bytes
   */
  @Post('upload-invoice-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    }),
  )
  async uploadInvoiceImage(
    @Request() req: any,
    @UploadedFile() file: any,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('يرجى اختيار ملف صورة صالح لرفعه');
    }
    return this.invoiceStorageService.uploadInvoiceImage(
      req.user.tenantId,
      file.buffer,
      file.originalname || 'invoice.jpg',
    );
  }

  /**
   * Retrieve securely stored invoice image
   */
  @Get('invoice-image')
  async getInvoiceImage(
    @Request() req: any,
    @Query('key') key: string,
    @Res() res: Response,
  ) {
    if (!key) {
      throw new BadRequestException('معرف مفتاح الصورة مطلوب');
    }
    const decodedKey = decodeURIComponent(key);
    const { buffer, mimeType } = await this.invoiceStorageService.getImageBuffer(
      req.user.tenantId,
      decodedKey,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  }

  /**
   * Get current AI invoice scanning usage metrics & limits for the pharmacy
   */
  @Get('ai-usage')
  getAiUsage(@Request() req: any) {
    const userId = req.user.id || req.user.sub || req.user.username;
    return this.aiUsageLimiterService.getUsageMetrics(req.user.tenantId, userId);
  }

  /**
   * Process invoice image with AI:
   * - Enforces Multi-Tier AI rate limits (per-user RPM, per-pharmacy RPM, daily and monthly quotas)
   * - Strictly validates that decoded image size does NOT exceed 10 MB
   * - Supports either storageKey (recommended) or direct imageBase64
   */
  @Post('ai-scan-invoice')
  async aiScanInvoice(
    @Request() req: any,
    @Body() body: { imageBase64?: string; storageKey?: string; rawTextHint?: string },
  ) {
    const userId = req.user.id || req.user.sub || req.user.username;
    const userName = req.user.name || req.user.username;

    // 1. Enforce AI Rate Limits & Multi-Tier Quotas (User RPM, Tenant RPM, Tenant Daily/Monthly)
    const quotaInfo = await this.aiUsageLimiterService.checkAndConsumeQuota(
      req.user.tenantId,
      userId,
      userName,
    );

    let base64 = body.imageBase64;
    let storageKey = body.storageKey;

    const MAX_DECODED_BYTES = 10 * 1024 * 1024; // 10 MB limit

    if (storageKey) {
      const { buffer, mimeType } = await this.invoiceStorageService.getImageBuffer(
        req.user.tenantId,
        storageKey,
      );
      if (buffer.length > MAX_DECODED_BYTES) {
        throw new BadRequestException(
          `حجم الصورة المخزنة (${(buffer.length / (1024 * 1024)).toFixed(2)} ميغابايت) يتجاوز الحد الأقصى المسموح به (10 ميغابايت).`,
        );
      }
      base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
    } else if (base64) {
      if (typeof base64 !== 'string' || base64.trim().length < 50) {
        throw new BadRequestException('صيغة بيانات الصورة Base64 غير صالحة.');
      }

      const rawBase64 = base64.includes('base64,') ? base64.split('base64,')[1].trim() : base64.trim();

      // Fast estimation check before buffer allocation
      const estimatedBytes = Math.ceil((rawBase64.length * 3) / 4);
      if (estimatedBytes > MAX_DECODED_BYTES * 1.05) {
        throw new BadRequestException(
          `حجم الصورة بعد فك الترميز (${(estimatedBytes / (1024 * 1024)).toFixed(2)} ميغابايت) يتجاوز الحد الأقصى المسموح به (10 ميغابايت).`,
        );
      }

      const buffer = Buffer.from(rawBase64, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestException('بيانات الصورة فارغة أو تالفة.');
      }
      if (buffer.length > MAX_DECODED_BYTES) {
        throw new BadRequestException(
          `حجم الصورة بعد فك الترميز (${(buffer.length / (1024 * 1024)).toFixed(2)} ميغابايت) يتجاوز الحد الأقصى المسموح به (10 ميغابايت).`,
        );
      }

      // Validate image signature / magic bytes (JPEG/PNG/WEBP)
      this.invoiceStorageService.validateImageBuffer(buffer);

      // Auto-archive incoming base64 to object storage
      try {
        const stored = await this.invoiceStorageService.uploadInvoiceImage(
          req.user.tenantId,
          buffer,
          'scanned_invoice.jpg',
        );
        storageKey = stored.storageKey;
      } catch (err: any) {
        // Non-blocking if storage is temporarily unreachable
      }
    } else {
      throw new BadRequestException('يرجى تقديم صورة الفاتورة عبر storageKey أو imageBase64');
    }

    const result = await this.ocrAiService.processInvoiceImage(req.user.tenantId, base64!);
    return {
      ...result,
      storageKey: storageKey || null,
      quota: quotaInfo,
    };
  }

  @Post()
  createPurchase(@Request() req: any, @Body() dto: CreatePurchaseDto) {
    return this.purchasesService.createPurchase(req.user.tenantId, dto);
  }

  @Get()
  getPurchases(@Request() req: any, @Query('search') search?: string) {
    return this.purchasesService.getPurchases(req.user.tenantId, search);
  }

  @Get('early-discount-alerts')
  getEarlyDiscountAlerts(@Request() req: any) {
    return this.purchasesService.getEarlyDiscountAlerts(req.user.tenantId);
  }

  @Post(':id/apply-early-discount')
  applyEarlyDiscount(@Request() req: any, @Param('id') id: string) {
    return this.purchasesService.applyEarlyDiscount(req.user.tenantId, id);
  }

  @Get(':id')
  getPurchaseById(@Request() req: any, @Param('id') id: string) {
    return this.purchasesService.getPurchaseById(req.user.tenantId, id);
  }
}
