-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateTable
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "schema_name" VARCHAR(100) NOT NULL,
    "governorate" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "address_details" TEXT,
    "google_maps_url" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "phone" VARCHAR(50) NOT NULL,
    "logo_url" TEXT,
    "receipt_header" TEXT,
    "receipt_footer" TEXT,
    "license_key" VARCHAR(255) NOT NULL,
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "subscription_ends_at" TIMESTAMP(3) NOT NULL,
    "last_backup_at" TIMESTAMP(3),
    "backup_status" VARCHAR(50) DEFAULT 'PENDING',
    "r2_bucket_name" VARCHAR(255),
    "r2_account_id" VARCHAR(255),
    "r2_access_key_id" VARCHAR(255),
    "r2_secret_access_key" TEXT,
    "is_search_visible" BOOLEAN NOT NULL DEFAULT true,
    "show_selling_prices" BOOLEAN NOT NULL DEFAULT true,
    "show_phone_number" BOOLEAN NOT NULL DEFAULT true,
    "show_whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "is_24_hours" BOOLEAN NOT NULL DEFAULT false,
    "gemini_api_key" TEXT,
    "chain_id" UUID,
    "chain_role" VARCHAR(50) DEFAULT 'BRANCH',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pharmacy_chains" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "owner_name" VARCHAR(255),
    "owner_phone" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_number" VARCHAR(100) NOT NULL,
    "chain_id" UUID NOT NULL,
    "source_tenant_id" UUID NOT NULL,
    "target_tenant_id" UUID NOT NULL,
    "source_pharmacy_name" VARCHAR(255) NOT NULL,
    "target_pharmacy_name" VARCHAR(255) NOT NULL,
    "medicine_id" UUID NOT NULL,
    "trade_name" VARCHAR(255) NOT NULL,
    "batch_number" VARCHAR(100),
    "expiry_date" TIMESTAMP(3),
    "quantity_packs" INTEGER NOT NULL,
    "quantity_units" INTEGER NOT NULL,
    "purchase_price_pack" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "batch_allocations" JSONB,
    "sender_user_name" VARCHAR(100),
    "receiver_user_name" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "medicines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trade_name" VARCHAR(255) NOT NULL,
    "scientific_name" VARCHAR(255),
    "dosage_form" VARCHAR(100),
    "strength" VARCHAR(100),
    "manufacturer" VARCHAR(255),
    "barcode" VARCHAR(100),
    "default_units_per_pack" INTEGER NOT NULL DEFAULT 1,
    "default_purchase_price" DECIMAL(12,2) DEFAULT 0,
    "needs_strength_review" BOOLEAN NOT NULL DEFAULT false,
    "needs_form_review" BOOLEAN NOT NULL DEFAULT false,
    "needs_packaging_review" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "central_search_index" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "medicine_id" UUID NOT NULL,
    "pharmacy_name" VARCHAR(255) NOT NULL,
    "governorate" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "address_details" TEXT,
    "google_maps_url" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "phone" VARCHAR(50) NOT NULL,
    "trade_name" VARCHAR(255) NOT NULL,
    "scientific_name" VARCHAR(255),
    "dosage_form" VARCHAR(100),
    "strength" VARCHAR(100),
    "selling_price_pack" DECIMAL(12,2) NOT NULL,
    "stock_status" VARCHAR(50) NOT NULL DEFAULT 'HIGH_STOCK',
    "show_selling_prices" BOOLEAN NOT NULL DEFAULT true,
    "show_phone_number" BOOLEAN NOT NULL DEFAULT true,
    "show_whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "is_24_hours" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_search_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "system_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_schema_name_key" ON "tenants"("schema_name");
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_license_key_key" ON "tenants"("license_key");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_transfers_transfer_number_key" ON "stock_transfers"("transfer_number");
CREATE INDEX IF NOT EXISTS "stock_transfers_chain_id_idx" ON "stock_transfers"("chain_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_source_tenant_id_idx" ON "stock_transfers"("source_tenant_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_target_tenant_id_idx" ON "stock_transfers"("target_tenant_id");
CREATE INDEX IF NOT EXISTS "medicines_barcode_idx" ON "medicines"("barcode");
CREATE INDEX IF NOT EXISTS "medicines_trade_name_idx" ON "medicines"("trade_name");
CREATE INDEX IF NOT EXISTS "medicines_scientific_name_idx" ON "medicines"("scientific_name");
CREATE UNIQUE INDEX IF NOT EXISTS "central_search_index_tenant_id_medicine_id_key" ON "central_search_index"("tenant_id", "medicine_id");
CREATE INDEX IF NOT EXISTS "central_search_index_governorate_district_idx" ON "central_search_index"("governorate", "district");
CREATE INDEX IF NOT EXISTS "central_search_index_trade_name_idx" ON "central_search_index"("trade_name");
CREATE INDEX IF NOT EXISTS "central_search_index_scientific_name_idx" ON "central_search_index"("scientific_name");
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'tenants_chain_id_fkey'
    ) THEN
        ALTER TABLE "tenants" ADD CONSTRAINT "tenants_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "pharmacy_chains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'stock_transfers_chain_id_fkey'
    ) THEN
        ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "pharmacy_chains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'central_search_index_tenant_id_fkey'
    ) THEN
        ALTER TABLE "central_search_index" ADD CONSTRAINT "central_search_index_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'central_search_index_medicine_id_fkey'
    ) THEN
        ALTER TABLE "central_search_index" ADD CONSTRAINT "central_search_index_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
