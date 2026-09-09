import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { decryptSecret } from '../../common/utils/security.util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface StoredInvoiceImage {
  storageKey: string;
  fileUrl: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: 'R2' | 'LOCAL';
}

@Injectable()
export class InvoiceStorageService {
  private readonly logger = new Logger(InvoiceStorageService.name);
  private readonly MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
  private readonly localStorageDir = path.resolve(process.cwd(), 'data', 'uploads', 'invoices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Ensure local storage directory exists
    try {
      if (!fs.existsSync(this.localStorageDir)) {
        fs.mkdirSync(this.localStorageDir, { recursive: true });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to initialize local storage dir: ${err.message}`);
    }
  }

  /**
   * Validate buffer magic bytes (Buffer Signature) to ensure it is a real image.
   * Prevents malicious executables disguised as image files.
   */
  validateImageBuffer(buffer: Buffer, originalFilename?: string): { mimeType: string; ext: string } {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('ملف الصورة فارغ');
    }

    if (buffer.length > this.MAX_SIZE_BYTES) {
      throw new BadRequestException('حجم الصورة يتجاوز الحد الأقصى المسموح به (10 ميغابايت)');
    }

    // 1. JPEG check: starts with FF D8 FF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: 'image/jpeg', ext: 'jpg' };
    }

    // 2. PNG check: starts with 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { mimeType: 'image/png', ext: 'png' };
    }

    // 3. WebP check: offset 0 'RIFF' (0x52 0x49 0x46 0x46), offset 8 'WEBP' (0x57 0x45 0x42 0x50)
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { mimeType: 'image/webp', ext: 'webp' };
    }

    this.logger.warn(`Rejected file with invalid magic bytes: ${originalFilename || 'unknown'}`);
    throw new BadRequestException('نوع الملف غير مدعوم أو غير صالح. الأنواع المدعومة هي JPEG و PNG و WEBP فقط.');
  }

  /**
   * Resolve R2 configuration from database settings or environment
   */
  private async getR2Config(tenantId?: string): Promise<{
    isConfigured: boolean;
    bucket: string;
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
  }> {
    // Check pharmacy-specific R2 if tenantId is provided
    if (tenantId) {
      try {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            r2BucketName: true,
            r2AccountId: true,
            r2AccessKeyId: true,
            r2SecretAccessKey: true,
          },
        });
        if (
          tenant?.r2BucketName &&
          tenant.r2AccountId &&
          tenant.r2AccessKeyId &&
          tenant.r2SecretAccessKey
        ) {
          return {
            isConfigured: true,
            bucket: tenant.r2BucketName,
            accountId: decryptSecret(tenant.r2AccountId),
            accessKeyId: decryptSecret(tenant.r2AccessKeyId),
            secretAccessKey: decryptSecret(tenant.r2SecretAccessKey),
          };
        }
      } catch {}
    }

    // Check Master R2 in SystemSettings
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: ['R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
          },
        },
      });
      const map = new Map(settings.map((s) => [s.key, s.value]));
      const b = map.get('R2_BUCKET_NAME');
      const a = map.get('R2_ACCOUNT_ID');
      const k = map.get('R2_ACCESS_KEY_ID');
      const s = map.get('R2_SECRET_ACCESS_KEY');
      if (b && a && k && s) {
        return {
          isConfigured: true,
          bucket: b,
          accountId: decryptSecret(a),
          accessKeyId: decryptSecret(k),
          secretAccessKey: decryptSecret(s),
        };
      }
    } catch {}

    // Check environment variables
    const envBucket = this.config.get<string>('R2_BUCKET_NAME') || process.env.R2_BUCKET_NAME;
    const envAccount = this.config.get<string>('R2_ACCOUNT_ID') || process.env.R2_ACCOUNT_ID;
    const envAccessKey = this.config.get<string>('R2_ACCESS_KEY_ID') || process.env.R2_ACCESS_KEY_ID;
    const envSecretKey = this.config.get<string>('R2_SECRET_ACCESS_KEY') || process.env.R2_SECRET_ACCESS_KEY;

    if (envBucket && envAccount && envAccessKey && envSecretKey) {
      return {
        isConfigured: true,
        bucket: envBucket,
        accountId: envAccount,
        accessKeyId: envAccessKey,
        secretAccessKey: envSecretKey,
      };
    }

    return {
      isConfigured: false,
      bucket: '',
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
    };
  }

  /**
   * Upload an invoice image buffer to R2 or isolated local storage
   */
  async uploadInvoiceImage(
    tenantId: string,
    buffer: Buffer,
    originalFilename: string = 'invoice.jpg',
  ): Promise<StoredInvoiceImage> {
    const { mimeType, ext } = this.validateImageBuffer(buffer, originalFilename);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const fileId = crypto.randomUUID();
    const safeFilename = `${fileId}.${ext}`;
    const storageKey = `invoices/${tenantId}/${dateStr}/${safeFilename}`;

    const r2Config = await this.getR2Config(tenantId);

    if (r2Config.isConfigured) {
      try {
        const s3 = new S3Client({
          region: 'auto',
          endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: r2Config.accessKeyId,
            secretAccessKey: r2Config.secretAccessKey,
          },
        });

        await s3.send(
          new PutObjectCommand({
            Bucket: r2Config.bucket,
            Key: storageKey,
            Body: buffer,
            ContentType: mimeType,
            Metadata: {
              tenantId,
              originalName: encodeURIComponent(originalFilename),
              uploadedAt: now.toISOString(),
            },
          }),
        );

        this.logger.log(`Uploaded invoice image to Cloudflare R2: ${storageKey}`);

        return {
          storageKey,
          fileUrl: `/api/purchases/invoice-image?key=${encodeURIComponent(storageKey)}`,
          filename: safeFilename,
          originalName: originalFilename,
          mimeType,
          sizeBytes: buffer.length,
          storageProvider: 'R2',
        };
      } catch (err: any) {
        this.logger.error(`Failed to upload to Cloudflare R2: ${err.message}, falling back to local storage.`);
      }
    }

    // Secure local storage fallback
    const tenantDir = path.join(this.localStorageDir, tenantId, dateStr);
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }
    const localFilePath = path.join(tenantDir, safeFilename);
    fs.writeFileSync(localFilePath, buffer);

    this.logger.log(`Stored invoice image locally: ${localFilePath}`);

    return {
      storageKey,
      fileUrl: `/api/purchases/invoice-image?key=${encodeURIComponent(storageKey)}`,
      filename: safeFilename,
      originalName: originalFilename,
      mimeType,
      sizeBytes: buffer.length,
      storageProvider: 'LOCAL',
    };
  }

  /**
   * Retrieve image buffer by storageKey
   */
  async getImageBuffer(
    tenantId: string,
    storageKey: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!storageKey || typeof storageKey !== 'string') {
      throw new BadRequestException('معرف تخزين الصورة غير صالح');
    }

    // Path traversal defense
    if (storageKey.includes('..') || storageKey.startsWith('/') || storageKey.startsWith('\\')) {
      throw new BadRequestException('مسار تخزين الصورة غير مصرح به');
    }

    // Ensure tenant only accesses their own images
    const keyParts = storageKey.split('/');
    if (keyParts.length >= 2 && keyParts[1] !== tenantId) {
      throw new BadRequestException('غير مصرح بالوصول إلى صورة خاصة بصيدلية أخرى');
    }

    // 1. Try R2
    const r2Config = await this.getR2Config(tenantId);
    if (r2Config.isConfigured) {
      try {
        const s3 = new S3Client({
          region: 'auto',
          endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: r2Config.accessKeyId,
            secretAccessKey: r2Config.secretAccessKey,
          },
        });

        const resp = await s3.send(
          new GetObjectCommand({
            Bucket: r2Config.bucket,
            Key: storageKey,
          }),
        );

        if (resp.Body) {
          const byteArray = await resp.Body.transformToByteArray();
          const buffer = Buffer.from(byteArray);
          const { mimeType } = this.validateImageBuffer(buffer);
          return { buffer, mimeType };
        }
      } catch (err: any) {
        this.logger.warn(`Could not fetch from R2: ${err.message}, checking local disk.`);
      }
    }

    // 2. Try local disk
    const normalizedKey = storageKey.replace(/^invoices\//, '');
    const localFilePath = path.join(this.localStorageDir, normalizedKey);

    if (fs.existsSync(localFilePath)) {
      const buffer = fs.readFileSync(localFilePath);
      const { mimeType } = this.validateImageBuffer(buffer);
      return { buffer, mimeType };
    }

    throw new NotFoundException('صورة الفاتورة غير موجودة في التخزين');
  }
}
