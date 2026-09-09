import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function main() {
  console.log('Provisioning sample pharmacy: صيدلية اليرموك...');

  const slug = 'pharmacy_yarmouk';
  const schemaName = 'ph_pharmacy_yarmouk_01';

  const statements = [
    `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
    `CREATE TABLE IF NOT EXISTS "${schemaName}".users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'CASHIER',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "${schemaName}".inventory_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      medicine_id UUID NOT NULL,
      units_per_pack INT NOT NULL DEFAULT 1,
      selling_price_pack DECIMAL(12, 2) NOT NULL,
      selling_price_unit DECIMAL(12, 2) NOT NULL,
      min_alert_units INT DEFAULT 5,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "${schemaName}".inventory_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inventory_item_id UUID REFERENCES "${schemaName}".inventory_items(id) ON DELETE CASCADE,
      batch_number VARCHAR(100),
      purchase_price_pack DECIMAL(12, 2) NOT NULL,
      quantity_units_remaining INT NOT NULL,
      expiry_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "${schemaName}".sales (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number VARCHAR(50) UNIQUE NOT NULL,
      user_id UUID REFERENCES "${schemaName}".users(id),
      subtotal DECIMAL(12, 2) NOT NULL,
      discount_amount DECIMAL(12, 2) DEFAULT 0,
      total_amount DECIMAL(12, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "${schemaName}".sale_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id UUID REFERENCES "${schemaName}".sales(id) ON DELETE CASCADE,
      inventory_item_id UUID REFERENCES "${schemaName}".inventory_items(id),
      inventory_batch_id UUID REFERENCES "${schemaName}".inventory_batches(id),
      unit_type VARCHAR(10) NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(12, 2) NOT NULL,
      total_price DECIMAL(12, 2) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "${schemaName}".returns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id UUID REFERENCES "${schemaName}".sales(id),
      inventory_item_id UUID REFERENCES "${schemaName}".inventory_items(id),
      user_id UUID REFERENCES "${schemaName}".users(id),
      unit_type VARCHAR(10) NOT NULL,
      quantity INT NOT NULL,
      refund_amount DECIMAL(12, 2) NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  ];

  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
  }

  // Create or get Tenant
  let tenant = await prisma.tenant.findUnique({ where: { slug } });

  if (!tenant) {
    const samplePass = 'Dawaee#Sample2026';
    const passwordHash = await bcrypt.hash(samplePass, 10);
    const ownerUserId = crypto.randomUUID();

    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaName}".users (id, name, username, password_hash, role, is_active)
      VALUES ($1::uuid, 'د. علي اليرموك', 'ali_owner', $2, 'OWNER', true)
      ON CONFLICT DO NOTHING;
    `, ownerUserId, passwordHash);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaName}".users (id, name, username, password_hash, role, is_active)
      VALUES ($1::uuid, 'أحمد الكاشير', 'ahmed_pos', $2, 'CASHIER', true)
      ON CONFLICT DO NOTHING;
    `, crypto.randomUUID(), passwordHash);

    const endsAt = new Date();
    endsAt.setFullYear(endsAt.getFullYear() + 1);

    tenant = await prisma.tenant.create({
      data: {
        name: 'صيدلية اليرموك الحديثة',
        slug,
        schemaName,
        governorate: 'بغداد',
        district: 'اليرموك',
        addressDetails: 'شارع الأربعين - قرب جامع ملوكي',
        googleMapsUrl: 'https://maps.google.com/?q=33.305,44.365',
        latitude: 33.305,
        longitude: 44.365,
        phone: '07701234567',
        licenseKey: 'DAWAEE-YARM-2026-ACTIVE',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: endsAt,
      },
    });

    console.log('Pharmacy tenant created successfully:', tenant.name);
  }

  // Seed sample shelf stock for medicines
  const medicines = await prisma.medicine.findMany({ take: 6 });

  for (const med of medicines) {
    const invItemId = crypto.randomUUID();
    const sellingPricePack = med.tradeName.includes('Panadol')
      ? 2000
      : med.tradeName.includes('Augmentin')
      ? 7500
      : 3500;

    const units = med.defaultUnitsPerPack || 2;
    const sellingPriceUnit = Math.round(sellingPricePack / units);

    // Insert Inventory Item
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaName}".inventory_items
      (id, medicine_id, units_per_pack, selling_price_pack, selling_price_unit, min_alert_units, created_at, updated_at)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, 5, NOW(), NOW())
      ON CONFLICT DO NOTHING;
    `, invItemId, med.id, units, sellingPricePack, sellingPriceUnit);

    // Insert Batch (20 packs = 40 strips)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${schemaName}".inventory_batches
      (id, inventory_item_id, batch_number, purchase_price_pack, quantity_units_remaining, expiry_date, created_at)
      VALUES ($1::uuid, $2::uuid, 'BN-2026', $3, $4, '2028-12-01'::date, NOW())
      ON CONFLICT DO NOTHING;
    `, crypto.randomUUID(), invItemId, sellingPricePack * 0.7, 20 * units);

    // Upsert into CentralSearchIndex
    await prisma.centralSearchIndex.upsert({
      where: {
        tenantId_medicineId: {
          tenantId: tenant.id,
          medicineId: med.id,
        },
      },
      update: {
        pharmacyName: tenant.name,
        governorate: tenant.governorate,
        district: tenant.district,
        addressDetails: tenant.addressDetails,
        googleMapsUrl: tenant.googleMapsUrl,
        phone: tenant.phone,
        tradeName: med.tradeName,
        scientificName: med.scientificName,
        sellingPricePack,
        isAvailable: true,
        lastSyncedAt: new Date(),
      },
      create: {
        tenantId: tenant.id,
        medicineId: med.id,
        pharmacyName: tenant.name,
        governorate: tenant.governorate,
        district: tenant.district,
        addressDetails: tenant.addressDetails,
        googleMapsUrl: tenant.googleMapsUrl,
        phone: tenant.phone,
        tradeName: med.tradeName,
        scientificName: med.scientificName,
        sellingPricePack,
        isAvailable: true,
        lastSyncedAt: new Date(),
      },
    });
  }

  console.log('Sample pharmacy stock seeded and synced to CentralSearchIndex!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
