import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../database/prisma.service";
import * as zlib from "zlib";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { maskSecretKey, encryptSecret, decryptSecret } from "../../common/utils/security.util";

export interface BackupResult {
  tenantId: string;
  name: string;
  slug: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  sizeKb?: number;
  uploadedToMaster?: boolean;
  uploadedToPharmacyR2?: boolean;
  error?: string;
  manifest?: Record<string, any>;
}

@Injectable()
export class R2BackupService {
  private readonly logger = new Logger(R2BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Get S3Client instance for Cloudflare R2
   */
  private getR2Client(accountId: string, accessKeyId: string, secretAccessKey: string): S3Client {
    return new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Extract Full Isolated Schema Data for a given Tenant covering all 16 system tables.
   * Strictly avoids silent swallowing (catch {}) on existing tables.
   */
  private async extractTenantData(tenant: any): Promise<any> {
    const schemaName = tenant.schemaName;

    // 1. Verify that tenant schema actually exists
    const schemaCheck: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1;
    `, schemaName);

    if (!schemaCheck || schemaCheck.length === 0) {
      throw new Error(`مخطط الصيدلية (${schemaName}) غير موجود في قاعدة البيانات`);
    }

    // 2. Discover all tables currently provisioned in this tenant schema
    const tableRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = $1;
    `, schemaName);
    const existingTables = new Set(tableRows.map((r: any) => r.table_name));

    // Helper: extracts table data if table exists; throws immediately if query fails!
    const extractTable = async (tableName: string, customSql?: string): Promise<any[]> => {
      if (!existingTables.has(tableName)) {
        return [];
      }
      try {
        const sql = customSql || `SELECT * FROM "${schemaName}"."${tableName}";`;
        return await this.prisma.$queryRawUnsafe(sql);
      } catch (err: any) {
        this.logger.error(`Critical error extracting table "${tableName}" from schema "${schemaName}": ${err.message}`);
        throw new Error(`فشل استخراج بيانات جدول (${tableName}) من قاعدة بيانات الصيدلية: ${err.message}`);
      }
    };

    // 3. Extract all 16 system tables
    const users = await extractTable("users", `
      SELECT id, name, username, password_hash as "passwordHash", role, is_active as "isActive", created_at as "createdAt"
      FROM "${schemaName}".users;
    `);

    const inventoryItems = await extractTable("inventory_items", `
      SELECT 
        ii.*,
        m.trade_name as "tradeName",
        m.scientific_name as "scientificName",
        m.barcode,
        m.dosage_form as "dosageForm",
        m.strength
      FROM "${schemaName}".inventory_items ii
      LEFT JOIN public.medicines m ON ii.medicine_id = m.id;
    `);

    const inventoryBatches = await extractTable("inventory_batches");
    const suppliers = await extractTable("suppliers");
    const purchases = await extractTable("purchases", `SELECT * FROM "${schemaName}".purchases ORDER BY created_at DESC;`);
    const purchaseItems = await extractTable("purchase_items");
    const purchaseInvoices = await extractTable("purchase_invoices", `SELECT * FROM "${schemaName}".purchase_invoices ORDER BY created_at DESC;`);
    const purchaseInvoiceItems = await extractTable("purchase_invoice_items");
    const supplierPayments = await extractTable("supplier_payments", `SELECT * FROM "${schemaName}".supplier_payments ORDER BY created_at DESC;`);
    const sales = await extractTable("sales", `SELECT * FROM "${schemaName}".sales ORDER BY created_at DESC;`);
    const saleItems = await extractTable("sale_items");
    const returns = await extractTable("returns", `SELECT * FROM "${schemaName}".returns ORDER BY created_at DESC;`);
    const expenses = await extractTable("expenses", `SELECT * FROM "${schemaName}".expenses ORDER BY created_at DESC;`);
    const shiftLogs = await extractTable("shift_logs", `SELECT * FROM "${schemaName}".shift_logs ORDER BY opened_at DESC;`);
    const stocktakeSessions = await extractTable("stocktake_sessions", `SELECT * FROM "${schemaName}".stocktake_sessions ORDER BY created_at DESC;`);
    const stocktakeItems = await extractTable("stocktake_items");

    // 4. Central search index items
    const searchIndexItems = await this.prisma.centralSearchIndex.findMany({
      where: { tenantId: tenant.id },
    });

    const manifest = {
      totalTablesInSchema: existingTables.size,
      tables: Array.from(existingTables),
      counts: {
        users: users.length,
        inventoryItems: inventoryItems.length,
        inventoryBatches: inventoryBatches.length,
        suppliers: suppliers.length,
        purchases: purchases.length,
        purchaseItems: purchaseItems.length,
        purchaseInvoices: purchaseInvoices.length,
        purchaseInvoiceItems: purchaseInvoiceItems.length,
        supplierPayments: supplierPayments.length,
        sales: sales.length,
        saleItems: saleItems.length,
        returns: returns.length,
        expenses: expenses.length,
        shiftLogs: shiftLogs.length,
        stocktakeSessions: stocktakeSessions.length,
        stocktakeItems: stocktakeItems.length,
        searchIndexItems: searchIndexItems.length,
      },
      extractedAt: new Date().toISOString(),
    };

    return {
      version: "2.0",
      system: "DAWAEE_CLOUD_R2_BACKUP",
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      schemaName: tenant.schemaName,
      hasSchema: true,
      exportedAt: new Date().toISOString(),
      manifest,
      data: {
        users,
        inventoryItems,
        inventoryBatches,
        suppliers,
        purchases,
        purchaseItems,
        purchaseInvoices,
        purchaseInvoiceItems,
        supplierPayments,
        sales,
        saleItems,
        returns,
        expenses,
        shiftLogs,
        stocktakeSessions,
        stocktakeItems,
        searchIndexItems,
      },
    };
  }

  /**
   * Backup a single tenant to Master R2 (and optional Pharmacy R2)
   */
  async backupTenant(tenant: any): Promise<BackupResult> {
    this.logger.log(`⏳ Starting R2 backup for tenant: ${tenant.name} (${tenant.slug})...`);

    try {
      // 1. Extract and Compress Data
      const rawData = await this.extractTenantData(tenant);
      const jsonString = JSON.stringify(rawData);
      const compressedBuffer = zlib.gzipSync(Buffer.from(jsonString, "utf-8"));
      const sizeKb = Number((compressedBuffer.length / 1024).toFixed(2));

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const isFirstDayOfMonth = now.getDate() === 1;
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      let uploadedToMaster = false;
      let uploadedToPharmacyR2 = false;

      // 2. Upload to Master Cloudflare R2 Bucket (Always)
      const masterConfig = await this.getMasterR2Config();

      if (masterConfig.isConfigured) {
        const masterClient = this.getR2Client(
          masterConfig.r2AccountId,
          masterConfig.r2AccessKeyId,
          masterConfig.r2SecretAccessKey,
        );

        // Daily upload key: daily/{slug}/backup_YYYY-MM-DD.json.gz
        const dailyKey = `daily/${tenant.slug}/backup_${dateStr}.json.gz`;
        await masterClient.send(
          new PutObjectCommand({
            Bucket: masterConfig.r2BucketName,
            Key: dailyKey,
            Body: compressedBuffer,
            ContentType: "application/gzip",
            Metadata: {
              tenantId: tenant.id,
              tenantSlug: tenant.slug,
              date: dateStr,
            },
          }),
        );
        uploadedToMaster = true;

        // Monthly retention (If 1st day of month): monthly/{slug}/backup_YYYY-MM.json.gz
        if (isFirstDayOfMonth) {
          const monthlyKey = `monthly/${tenant.slug}/backup_${monthStr}.json.gz`;
          await masterClient.send(
            new PutObjectCommand({
              Bucket: masterConfig.r2BucketName,
              Key: monthlyKey,
              Body: compressedBuffer,
              ContentType: "application/gzip",
              Metadata: {
                tenantId: tenant.id,
                tenantSlug: tenant.slug,
                month: monthStr,
              },
            }),
          );
        }
      } else {
        this.logger.warn(`⚠️ Master R2 credentials not configured in Super Admin settings or environment variables, skipping Master upload.`);
      }

      // 3. Upload to Pharmacy-specific Cloudflare R2 (If configured)
      const pharmacyAccount = decryptSecret(tenant.r2AccountId);
      const pharmacyAccessKey = decryptSecret(tenant.r2AccessKeyId);
      const pharmacySecret = decryptSecret(tenant.r2SecretAccessKey);

      if (tenant.r2BucketName && pharmacyAccount && pharmacyAccessKey && pharmacySecret) {
        try {
          const pharmacyClient = this.getR2Client(
            pharmacyAccount,
            pharmacyAccessKey,
            pharmacySecret,
          );
          const pharmacyKey = `backups/backup_${dateStr}.json.gz`;
          await pharmacyClient.send(
            new PutObjectCommand({
              Bucket: tenant.r2BucketName,
              Key: pharmacyKey,
              Body: compressedBuffer,
              ContentType: "application/gzip",
            }),
          );
          uploadedToPharmacyR2 = true;
        } catch (pharmacyUploadError: any) {
          this.logger.error(`Failed to upload to pharmacy private R2 bucket: ${pharmacyUploadError.message}`);
        }
      }

      // 4. Update lastBackupAt in Tenant Master Table
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          lastBackupAt: new Date(),
          backupStatus: "SUCCESS",
        },
      });

      this.logger.log(`✅ Successfully backed up tenant: ${tenant.name} (${sizeKb} KB)`);
      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: "SUCCESS",
        sizeKb,
        uploadedToMaster,
        uploadedToPharmacyR2,
        manifest: rawData.manifest,
      };
    } catch (err: any) {
      this.logger.error(`❌ Error backing up tenant ${tenant.name}: ${err.message}`);
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          backupStatus: "FAILED",
        },
      }).catch(() => {});

      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: "FAILED",
        error: err.message,
      };
    }
  }

  /**
   * Sequential Daily Backup Job for all Active/Read-only Tenants
   */
  async runDailyBackupJob(): Promise<{ total: number; successful: number; failed: number; results: BackupResult[] }> {
    this.logger.log(`🚀 Starting Daily Cloudflare R2 Backup Job for all pharmacies...`);

    const tenants = await this.prisma.tenant.findMany({
      where: {
        subscriptionStatus: {
          in: ["ACTIVE", "EXPIRED"], // Exclude SUSPENDED / Deleted
        },
      },
      orderBy: { name: "asc" },
    });

    this.logger.log(`Found ${tenants.length} pharmacies to back up.`);

    const results: BackupResult[] = [];
    let successful = 0;
    let failed = 0;

    // Sequential iteration to prevent database overload
    for (const tenant of tenants) {
      const res = await this.backupTenant(tenant);
      results.push(res);
      if (res.status === "SUCCESS") {
        successful++;
      } else {
        failed++;
      }
    }

    this.logger.log(`🎉 Daily Cloudflare R2 Backup Completed! Total: ${tenants.length}, Successful: ${successful}, Failed: ${failed}`);
    return {
      total: tenants.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Super Admin Monitoring Summary
   * Strips raw access keys and secrets to prevent leaking credentials in monitoring dashboards.
   */
  async getBackupsMonitoringSummary() {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        governorate: true,
        district: true,
        phone: true,
        subscriptionStatus: true,
        lastBackupAt: true,
        backupStatus: true,
        r2BucketName: true,
      },
      orderBy: { name: "asc" },
    });

    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const THREE_DAYS_MS = 72 * 60 * 60 * 1000;

    let healthyCount = 0;
    let warningCount = 0;
    let alertCount = 0;

    const monitoredTenants = tenants.map((t) => {
      let health: "HEALTHY" | "WARNING" | "ALERT" = "ALERT";
      let hoursSinceLastBackup: number | null = null;

      if (t.lastBackupAt) {
        const diffMs = now - new Date(t.lastBackupAt).getTime();
        hoursSinceLastBackup = Math.round(diffMs / (1000 * 60 * 60));

        if (diffMs <= ONE_DAY_MS && t.backupStatus === "SUCCESS") {
          health = "HEALTHY";
          healthyCount++;
        } else if (diffMs <= THREE_DAYS_MS) {
          health = "WARNING";
          warningCount++;
        } else {
          health = "ALERT";
          alertCount++;
        }
      } else {
        alertCount++;
      }

      return {
        ...t,
        health,
        hoursSinceLastBackup,
        hasCustomR2: Boolean(t.r2BucketName),
      };
    });

    const masterR2 = await this.getMasterR2Config();

    return {
      summary: {
        totalPharmacies: tenants.length,
        healthyCount,
        warningCount,
        alertCount,
        lastJobRunAt: new Date().toISOString(),
      },
      masterR2: {
        r2BucketName: masterR2.r2BucketName,
        r2AccountIdMasked: maskSecretKey(masterR2.r2AccountId),
        r2AccessKeyIdMasked: maskSecretKey(masterR2.r2AccessKeyId),
        hasAccessKey: Boolean(masterR2.r2AccessKeyId),
        hasSecretKey: Boolean(masterR2.r2SecretAccessKey),
        isConfigured: masterR2.isConfigured,
        source: masterR2.source,
      },
      pharmacies: monitoredTenants,
    };
  }

  /**
   * Retrieve Master R2 configuration (from DB SystemSettings, with fallback to env)
   * Automatically decrypts AES-256-GCM encrypted database credentials
   */
  async getMasterR2Config(): Promise<{
    r2BucketName: string;
    r2AccountId: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    isConfigured: boolean;
    source: "DATABASE" | "ENV" | "NONE";
  }> {
    try {
      const settings = await this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: ["R2_BUCKET_NAME", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
          },
        },
      });

      const settingMap = new Map(settings.map((s) => [s.key, s.value]));

      const dbBucket = settingMap.get("R2_BUCKET_NAME");
      const dbAccount = settingMap.get("R2_ACCOUNT_ID");
      const dbAccessKey = settingMap.get("R2_ACCESS_KEY_ID");
      const dbSecretKey = settingMap.get("R2_SECRET_ACCESS_KEY");

      if (dbBucket && dbAccount && dbAccessKey && dbSecretKey) {
        return {
          r2BucketName: dbBucket,
          r2AccountId: decryptSecret(dbAccount),
          r2AccessKeyId: decryptSecret(dbAccessKey),
          r2SecretAccessKey: decryptSecret(dbSecretKey),
          isConfigured: true,
          source: "DATABASE",
        };
      }
    } catch {
      // Fallback if table not ready
    }

    const envBucket = this.config.get<string>("R2_BUCKET_NAME") || process.env.R2_BUCKET_NAME || "dawaee-backups";
    const envAccount = this.config.get<string>("R2_ACCOUNT_ID") || process.env.R2_ACCOUNT_ID;
    const envAccessKey = this.config.get<string>("R2_ACCESS_KEY_ID") || process.env.R2_ACCESS_KEY_ID;
    const envSecretKey = this.config.get<string>("R2_SECRET_ACCESS_KEY") || process.env.R2_SECRET_ACCESS_KEY;

    if (envAccount && envAccessKey && envSecretKey) {
      return {
        r2BucketName: envBucket,
        r2AccountId: envAccount,
        r2AccessKeyId: envAccessKey,
        r2SecretAccessKey: envSecretKey,
        isConfigured: true,
        source: "ENV",
      };
    }

    return {
      r2BucketName: envBucket || "",
      r2AccountId: envAccount || "",
      r2AccessKeyId: envAccessKey || "",
      r2SecretAccessKey: envSecretKey || "",
      isConfigured: false,
      source: "NONE",
    };
  }

  /**
   * Retrieve Master R2 public configuration for admin client display (WITH MASKED ACCESS AND SECRET KEYS)
   * Prevents leaking plaintext Cloudflare/AWS Access Key and Secret Key over REST API
   */
  async getMasterR2PublicConfig(): Promise<{
    r2BucketName: string;
    r2AccountIdMasked: string;
    r2AccessKeyIdMasked: string;
    r2SecretAccessKeyMasked: string;
    hasAccountId: boolean;
    hasAccessKey: boolean;
    hasSecretKey: boolean;
    isConfigured: boolean;
    source: "DATABASE" | "ENV" | "NONE";
  }> {
    const full = await this.getMasterR2Config();
    return {
      r2BucketName: full.r2BucketName,
      r2AccountIdMasked: maskSecretKey(full.r2AccountId),
      r2AccessKeyIdMasked: maskSecretKey(full.r2AccessKeyId),
      r2SecretAccessKeyMasked: maskSecretKey(full.r2SecretAccessKey),
      hasAccountId: Boolean(full.r2AccountId),
      hasAccessKey: Boolean(full.r2AccessKeyId),
      hasSecretKey: Boolean(full.r2SecretAccessKey),
      isConfigured: full.isConfigured,
      source: full.source,
    };
  }

  /**
   * Save Master R2 configuration into DB SystemSettings with AES-256-GCM encryption
   */
  async saveMasterR2Config(dto: {
    r2BucketName: string;
    r2AccountId: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
  }) {
    const rawBucket = (dto.r2BucketName || "dawaee-backups").trim();
    const rawAccount = (dto.r2AccountId || "").trim();
    const rawAccessKey = (dto.r2AccessKeyId || "").trim();
    const rawSecret = (dto.r2SecretAccessKey || "").trim();

    const entries: { key: string; value: string }[] = [
      { key: "R2_BUCKET_NAME", value: rawBucket },
    ];

    // Only update R2_ACCOUNT_ID if not masked and not empty
    if (rawAccount && !rawAccount.startsWith("•••") && !rawAccount.includes("••••")) {
      entries.push({ key: "R2_ACCOUNT_ID", value: encryptSecret(rawAccount) });
    }

    // Only update R2_ACCESS_KEY_ID if not masked and not empty
    if (rawAccessKey && !rawAccessKey.startsWith("•••") && !rawAccessKey.includes("••••")) {
      entries.push({ key: "R2_ACCESS_KEY_ID", value: encryptSecret(rawAccessKey) });
    }

    // Only update R2_SECRET_ACCESS_KEY if not masked and not empty
    if (rawSecret && !rawSecret.startsWith("•••") && !rawSecret.includes("••••")) {
      entries.push({ key: "R2_SECRET_ACCESS_KEY", value: encryptSecret(rawSecret) });
    }

    for (const entry of entries) {
      if (entry.value) {
        await this.prisma.systemSetting.upsert({
          where: { key: entry.key },
          update: { value: entry.value },
          create: { key: entry.key, value: entry.value },
        });
      }
    }

    this.logger.log("✅ Master Cloudflare R2 credentials safely encrypted and updated in database.");
    return { success: true, message: "تم حفظ وتشفير إعدادات Cloudflare R2 المركزية بنجاح" };
  }
}
