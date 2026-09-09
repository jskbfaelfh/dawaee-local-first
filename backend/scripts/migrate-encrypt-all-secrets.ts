import { PrismaClient } from '@prisma/client';
import { encryptSecret } from '../src/common/utils/security.util';

const prisma = new PrismaClient();

async function migrateEncryptAllSecrets() {
  console.log('=== Database Migration: Encrypt All Plaintext Secrets at Rest ===');

  // 1. Migrate Tenants
  const tenants = await prisma.tenant.findMany({});
  console.log(`Found ${tenants.length} tenants in database.`);

  let updatedTenantsCount = 0;

  for (const t of tenants) {
    const data: any = {};
    let needsUpdate = false;

    if (t.r2AccountId && !t.r2AccountId.startsWith('enc:v1:')) {
      data.r2AccountId = encryptSecret(t.r2AccountId);
      needsUpdate = true;
    }
    if (t.r2AccessKeyId && !t.r2AccessKeyId.startsWith('enc:v1:')) {
      data.r2AccessKeyId = encryptSecret(t.r2AccessKeyId);
      needsUpdate = true;
    }
    if (t.r2SecretAccessKey && !t.r2SecretAccessKey.startsWith('enc:v1:')) {
      data.r2SecretAccessKey = encryptSecret(t.r2SecretAccessKey);
      needsUpdate = true;
    }
    if (t.geminiApiKey && !t.geminiApiKey.startsWith('enc:v1:')) {
      data.geminiApiKey = encryptSecret(t.geminiApiKey);
      needsUpdate = true;
    }

    if (needsUpdate) {
      await prisma.tenant.update({
        where: { id: t.id },
        data,
      });
      updatedTenantsCount++;
      console.log(`  ✓ Encrypted secrets for tenant: ${t.name} (${t.slug})`);
    }
  }

  // 2. Migrate System Settings
  const settings = await prisma.systemSetting.findMany({
    where: {
      key: { in: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] },
    },
  });

  let updatedSettingsCount = 0;
  for (const s of settings) {
    if (s.value && !s.value.startsWith('enc:v1:')) {
      await prisma.systemSetting.update({
        where: { key: s.key },
        data: { value: encryptSecret(s.value) },
      });
      updatedSettingsCount++;
      console.log(`  ✓ Encrypted system setting: ${s.key}`);
    }
  }

  console.log(`\nMigration completed successfully!`);
  console.log(`- Tenants encrypted: ${updatedTenantsCount}`);
  console.log(`- System settings encrypted: ${updatedSettingsCount}`);
}

migrateEncryptAllSecrets()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
