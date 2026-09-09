import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

const cwdEnv = path.resolve(process.cwd(), '.env');
dotenv.config({ path: cwdEnv });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

let dbUrl = process.env.DATABASE_URL || '';
dbUrl = dbUrl.replace(/connection_limit=\d+/, 'connection_limit=2').replace(/pool_timeout=\d+/, 'pool_timeout=30');

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

async function safeDb<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
  throw new Error('safeDb retries exhausted');
}

const API_URL = 'http://localhost:4000';
const JWT_SECRET = process.env.JWT_SECRET || 'dawaee-jwt-dev-secret-key-2026';

jest.setTimeout(180000);

describe('Pharmaceutical ERP Business Logic & Integrity (11 Critical Scenarios)', () => {
  let tenantA: any;
  let tenantB: any;
  let ownerA: any;
  let ownerB: any;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    // 1. Fetch 2 active tenants
    const tenants = await safeDb(() =>
      prisma.tenant.findMany({
        where: { subscriptionStatus: 'ACTIVE' },
        take: 2,
      })
    );

    if (tenants.length < 2) {
      throw new Error('Need at least 2 active tenants in DB for testing multi-tenancy and branch switching.');
    }

    tenantA = tenants[0];
    tenantB = tenants[1];

    // 2. Fetch real Owner for Tenant A
    const usersA: any[] = await safeDb(() =>
      prisma.$queryRawUnsafe(
        `SELECT id, username, name, role FROM "${tenantA.schemaName}".users WHERE role = 'OWNER' LIMIT 1`
      )
    );
    if (usersA.length === 0) throw new Error(`No OWNER user found in ${tenantA.name}`);
    ownerA = usersA[0];

    // 3. Fetch real Owner for Tenant B
    const usersB: any[] = await safeDb(() =>
      prisma.$queryRawUnsafe(
        `SELECT id, username, name, role FROM "${tenantB.schemaName}".users WHERE role = 'OWNER' LIMIT 1`
      )
    );
    if (usersB.length === 0) throw new Error(`No OWNER user found in ${tenantB.name}`);
    ownerB = usersB[0];

    // 4. Generate authentic JWT tokens
    tokenA = jwt.sign(
      {
        sub: ownerA.id,
        userId: ownerA.id,
        username: ownerA.username,
        name: ownerA.name,
        role: 'OWNER',
        tenantId: tenantA.id,
        schemaName: tenantA.schemaName,
        subscriptionStatus: 'ACTIVE',
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    tokenB = jwt.sign(
      {
        sub: ownerB.id,
        userId: ownerB.id,
        username: ownerB.username,
        name: ownerB.name,
        role: 'OWNER',
        tenantId: tenantB.id,
        schemaName: tenantB.schemaName,
        subscriptionStatus: 'ACTIVE',
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => {});
  });

  // =========================================================================
  // SCENARIO 1: بيع آخر batch (Depleted / Boundary Stock Checkout)
  // =========================================================================
  describe('Scenario 1: بيع آخر batch (Depleted Stock Boundary)', () => {
    it('should sell the remaining units of the last batch to 0, then strictly reject any subsequent checkout with 400', async () => {
      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Boundary_Med_${Date.now()}`,
            scientificName: 'Boundary Check',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const batchId = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'BoundaryItem', 1, 1500, 1500)`,
          invId,
          med.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-LAST-5', 5, 800, NOW() + INTERVAL '1 year')`,
          batchId,
          invId
        );
      });

      // 1. Checkout exactly 5 units -> Should succeed (201) and bring stock to 0
      const saleRes = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 5 }],
          discountAmount: 0,
        });

      expect(saleRes.status).toBe(201);

      // Verify batch in DB has exactly 0 units remaining
      const batchesAfter: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          batchId
        )
      );
      expect(Number(batchesAfter[0].quantity_units_remaining)).toBe(0);

      // 2. Immediate checkout of 1 unit -> Must be rejected with 400 Bad Request
      const overSaleRes = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 1 }],
          discountAmount: 0,
        });

      expect(overSaleRes.status).toBe(400);
      expect(overSaleRes.body.message).toMatch(/غير متوفرة في المخزون/);

      // 3. Verify zero AUTO-DEFICIT batches were created
      const deficitBatches: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id FROM "${tenantA.schemaName}".inventory_batches WHERE inventory_item_id = $1::uuid AND batch_number LIKE '%AUTO-DEFICIT%'`,
          invId
        )
      );
      expect(deficitBatches.length).toBe(0);
    });
  });

  // =========================================================================
  // SCENARIO 2: بيع متزامن (Concurrent Checkout & Pessimistic Locks)
  // =========================================================================
  describe('Scenario 2: بيع متزامن (Concurrent Checkout & Pessimistic Locks)', () => {
    it('should serialize concurrent checkout requests using row-level locks, preventing negative stock or race conditions', async () => {
      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Concurrent_Med_${Date.now()}`,
            scientificName: 'Concurrency Drug',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const batchId = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'ConcurrentItem', 1, 2000, 2000)`,
          invId,
          med.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-CONCURRENT-10', 10, 1000, NOW() + INTERVAL '1 year')`,
          batchId,
          invId
        );
      });

      // Launch 2 parallel requests simultaneously, each requesting 5 units
      const reqA = request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 5 }],
          discountAmount: 0,
        });

      const reqB = request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 5 }],
          discountAmount: 0,
        });

      const [resA, resB] = await Promise.all([reqA, reqB]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      // Assert stock in DB is EXACTLY 0
      const batchRow: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          batchId
        )
      );
      expect(Number(batchRow[0].quantity_units_remaining)).toBe(0);

      // Subsequent checkout request must fail
      const reqC = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 2 }],
          discountAmount: 0,
        });

      expect(reqC.status).toBe(400);
    });
  });

  // =========================================================================
  // SCENARIO 3: return من أكثر من batch (Multi-Batch Reverse-FEFO Returns)
  // =========================================================================
  describe('Scenario 3: return من أكثر من batch (Multi-Batch Reverse-FEFO Returns)', () => {
    it('should allocate multi-batch sales accurately, refund in Reverse-FEFO order, and reject over-returns with 400', async () => {
      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_MultiBatch_Return_${Date.now()}`,
            scientificName: 'Multi Batch Return',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const b1Id = crypto.randomUUID();
      const b2Id = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'MultiReturnItem', 1, 1000, 1000)`,
          invId,
          med.id
        );
        // Batch 1 (Early expiry): 4 units
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-EARLY-4', 4, 600, NOW() + INTERVAL '3 months')`,
          b1Id,
          invId
        );
        // Batch 2 (Late expiry): 6 units
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-LATE-6', 6, 700, NOW() + INTERVAL '18 months')`,
          b2Id,
          invId
        );
      });

      // 1. Checkout 10 units (FEFO: 4 from B1, 6 from B2)
      const saleRes = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 10 }],
          discountAmount: 0,
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;

      // 2. Return 3 units -> Reverse-FEFO must refund 3 to Batch 2 (latest expiry)
      const ret1Res = await request(API_URL)
        .post('/api/pos/return')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          saleId,
          items: [{ inventoryItemId: invId, quantity: 3, unitType: 'PACK' }],
          reason: 'Excess stock return 1',
        });

      expect(ret1Res.status).toBe(201);

      const [b1AfterRet1, b2AfterRet1]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id, quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id IN ($1::uuid, $2::uuid) ORDER BY expiry_date ASC`,
          b1Id,
          b2Id
        )
      );
      expect(Number(b1AfterRet1.quantity_units_remaining)).toBe(0);
      expect(Number(b2AfterRet1.quantity_units_remaining)).toBe(3);

      // 3. Return 5 units -> Should fill Batch 2 with 3 units (up to 6) and overflow 2 units into Batch 1
      const ret2Res = await request(API_URL)
        .post('/api/pos/return')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          saleId,
          items: [{ inventoryItemId: invId, quantity: 5, unitType: 'PACK' }],
          reason: 'Excess stock return 2',
        });

      expect(ret2Res.status).toBe(201);

      const [b1AfterRet2, b2AfterRet2]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id, quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id IN ($1::uuid, $2::uuid) ORDER BY expiry_date ASC`,
          b1Id,
          b2Id
        )
      );
      expect(Number(b1AfterRet2.quantity_units_remaining)).toBe(2);
      expect(Number(b2AfterRet2.quantity_units_remaining)).toBe(6);

      // 4. Try returning 3 units (only 2 units remain eligible out of the original 10 sold) -> 400 Bad Request
      const ret3Res = await request(API_URL)
        .post('/api/pos/return')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          saleId,
          items: [{ inventoryItemId: invId, quantity: 3, unitType: 'PACK' }],
          reason: 'Over-return attempt',
        });

      expect(ret3Res.status).toBe(400);
      expect(ret3Res.body.message).toMatch(/تتجاوز الكمية المتبقية القابلة للإرجاع/);

      // 5. Return the exact remaining 2 units -> Restores Batch 1 to 4 and Batch 2 to 6
      const ret4Res = await request(API_URL)
        .post('/api/pos/return')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          saleId,
          items: [{ inventoryItemId: invId, quantity: 2, unitType: 'PACK' }],
          reason: 'Final legitimate return',
        });

      expect(ret4Res.status).toBe(201);

      const [b1Final, b2Final]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id, quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id IN ($1::uuid, $2::uuid) ORDER BY expiry_date ASC`,
          b1Id,
          b2Id
        )
      );
      expect(Number(b1Final.quantity_units_remaining)).toBe(4);
      expect(Number(b2Final.quantity_units_remaining)).toBe(6);
    });
  });

  // =========================================================================
  // SCENARIO 4: purchase rollback (Purchase Atomicity on Failure)
  // =========================================================================
  describe('Scenario 4: purchase rollback (Purchase Atomicity on Failure)', () => {
    it('should roll back the entire purchase transaction if an item fails, leaving zero orphaned records', async () => {
      const initialPurchases: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int as count FROM "${tenantA.schemaName}".purchases`
        )
      );
      const initialCount = initialPurchases[0].count;

      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Rollback_Med_${Date.now()}`,
            scientificName: 'Rollback Med',
            defaultUnitsPerPack: 1,
          },
        })
      );

      // Attempt purchase where item 2 has an invalid medicineId
      const res = await request(API_URL)
        .post('/api/purchases')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          supplierName: 'Reliable Wholesaler',
          paidAmount: 5000,
          items: [
            {
              medicineId: med.id,
              quantityPacks: 10,
              purchasePricePack: 500,
              sellingPricePack: 800,
              batchNumber: 'ROLLBACK-B1',
              expiryDate: '2027-12-01',
            },
            {
              medicineId: '00000000-0000-0000-0000-000000000000',
              quantityPacks: 5,
              purchasePricePack: 400,
              sellingPricePack: 600,
            },
          ],
        });

      expect(res.status).toBeGreaterThanOrEqual(400);

      // Verify ZERO new purchases in DB
      const afterPurchases: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int as count FROM "${tenantA.schemaName}".purchases`
        )
      );
      expect(afterPurchases[0].count).toBe(initialCount);

      // Verify Batch ROLLBACK-B1 was NOT committed
      const batches: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id FROM "${tenantA.schemaName}".inventory_batches WHERE batch_number = 'ROLLBACK-B1'`
        )
      );
      expect(batches.length).toBe(0);
    });
  });

  // =========================================================================
  // SCENARIO 5: transfer rollback (Inter-Branch Transfer Atomicity & Cancel)
  // =========================================================================
  describe('Scenario 5: transfer rollback (Inter-Branch Transfer Atomicity & Cancel)', () => {
    it('should refund multi-batch allocations back to their exact original batches upon transfer cancellation', async () => {
      // Ensure a chain exists connecting tenantA and tenantB
      const chains: any[] = await safeDb(() => prisma.$queryRawUnsafe(`SELECT id FROM public.chains LIMIT 1`));
      let chainId = chains.length > 0 ? chains[0].id : null;

      if (!chainId) {
        chainId = crypto.randomUUID();
        await safeDb(() =>
          prisma.$executeRawUnsafe(
            `INSERT INTO public.chains (id, name, created_at, updated_at) VALUES ($1::uuid, 'Test Chain', NOW(), NOW())`,
            chainId
          )
        );
      }

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(`UPDATE public.tenants SET chain_id = $1::uuid WHERE id = $2::uuid`, chainId, tenantA.id);
        await prisma.$executeRawUnsafe(`UPDATE public.tenants SET chain_id = $1::uuid WHERE id = $2::uuid`, chainId, tenantB.id);
      });

      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Transfer_Med_${Date.now()}`,
            scientificName: 'Transfer Med',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const b1Id = crypto.randomUUID();
      const b2Id = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'TransferItem', 1, 1000, 1000)`,
          invId,
          med.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'TRF-BATCH-1', 4, 500, NOW() + INTERVAL '6 months')`,
          b1Id,
          invId
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'TRF-BATCH-2', 6, 600, NOW() + INTERVAL '12 months')`,
          b2Id,
          invId
        );
      });

      // Create transfer of 7 units (takes 4 from B1, 3 from B2)
      const trfRes = await request(API_URL)
        .post('/api/chain/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          targetTenantId: tenantB.id,
          medicineId: med.id,
          quantityPacks: 7,
          notes: 'Inter-branch stock rebalancing',
        });

      expect(trfRes.status).toBe(201);
      const transferId = trfRes.body.id;

      // Verify stock was deducted: B1 = 0, B2 = 3
      const [b1AfterTrf, b2AfterTrf]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id, quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id IN ($1::uuid, $2::uuid) ORDER BY expiry_date ASC`,
          b1Id,
          b2Id
        )
      );
      expect(Number(b1AfterTrf.quantity_units_remaining)).toBe(0);
      expect(Number(b2AfterTrf.quantity_units_remaining)).toBe(3);

      // Cancel transfer -> Must refund 4 to B1 and 3 to B2
      const cancelRes = await request(API_URL)
        .post(`/api/chain/transfers/${transferId}/cancel`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Shipment damaged before departure' });

      expect(cancelRes.status).toBe(200);

      // Verify stock restored cleanly to 4 and 6
      const [b1Final, b2Final]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT id, quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id IN ($1::uuid, $2::uuid) ORDER BY expiry_date ASC`,
          b1Id,
          b2Id
        )
      );
      expect(Number(b1Final.quantity_units_remaining)).toBe(4);
      expect(Number(b2Final.quantity_units_remaining)).toBe(6);
    });
  });

  // =========================================================================
  // SCENARIO 6: expired medicine (Blocking Dispensing of Expired Medicine)
  // =========================================================================
  describe('Scenario 6: expired medicine (Blocking Dispensing of Expired Medicine)', () => {
    it('should strictly exclude expired batches from checkout and reject sales when only expired stock exists', async () => {
      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Expired_Med_${Date.now()}`,
            scientificName: 'Expiry Guard',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const expiredBatchId = crypto.randomUUID();
      const validBatchId = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'ExpiredGuardItem', 1, 1200, 1200)`,
          invId,
          med.id
        );
        // Expired Batch: 10 units, expired 10 days ago
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-EXPIRED', 10, 500, NOW() - INTERVAL '10 days')`,
          expiredBatchId,
          invId
        );
        // Valid Batch: 3 units, expires in 1 year
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-VALID', 3, 500, NOW() + INTERVAL '1 year')`,
          validBatchId,
          invId
        );
      });

      // 1. Checkout 2 units -> Must deduct from valid batch ONLY
      const saleRes = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 2 }],
          discountAmount: 0,
        });

      expect(saleRes.status).toBe(201);

      // Verify Expired batch was completely untouched (10 units remain)
      const [expBatch]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          expiredBatchId
        )
      );
      expect(Number(expBatch.quantity_units_remaining)).toBe(10);

      // Verify Valid batch was decremented to 1
      const [valBatch]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          validBatchId
        )
      );
      expect(Number(valBatch.quantity_units_remaining)).toBe(1);

      // 2. Attempt checkout of 3 units (only 1 valid unit exists; 10 expired units must NOT be used)
      const failRes = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 3 }],
          discountAmount: 0,
        });

      expect(failRes.status).toBe(400);
      expect(failRes.body.message).toMatch(/غير متوفرة في المخزون/);
    });
  });

  // =========================================================================
  // SCENARIO 7: recalled medicine (Blocking Dispensing of Recalled Batches)
  // =========================================================================
  describe('Scenario 7: recalled medicine (Blocking Dispensing of Recalled Batches)', () => {
    it('should quarantine recalled batches and prevent their sale even if they have active stock', async () => {
      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Recalled_Med_${Date.now()}`,
            scientificName: 'Recall Guard',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const recalledBatchId = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'RecallGuardItem', 1, 1500, 1500)`,
          invId,
          med.id
        );
        // Recalled Batch: 15 units, is_recalled = TRUE
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date, is_recalled)
             VALUES ($1::uuid, $2::uuid, 'BATCH-RECALLED', 15, 600, NOW() + INTERVAL '1 year', TRUE)`,
          recalledBatchId,
          invId
        );
      });

      // Attempt checkout of 1 unit -> Must be rejected with 400 Bad Request
      const res = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 1 }],
          discountAmount: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/غير متوفرة في المخزون/);

      // Verify batch remains 15 units
      const [recalledBatch]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          recalledBatchId
        )
      );
      expect(Number(recalledBatch.quantity_units_remaining)).toBe(15);
    });
  });

  // =========================================================================
  // SCENARIO 8: offline duplicate (Offline Queue Idempotency & Deduplication)
  // =========================================================================
  describe('Scenario 8: offline duplicate (Offline Queue Idempotency & Deduplication)', () => {
    it('should replay existing sale on duplicate offlineId without deducting inventory a second time', async () => {
      const med = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Test_Offline_Med_${Date.now()}`,
            scientificName: 'Offline Idempotent',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invId = crypto.randomUUID();
      const batchId = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'OfflineItem', 1, 1000, 1000)`,
          invId,
          med.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-OFFLINE', 10, 500, NOW() + INTERVAL '1 year')`,
          batchId,
          invId
        );
      });

      const offlineId = `OFFLINE-UUID-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      // First submission
      const res1 = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          offlineId,
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 3 }],
          discountAmount: 0,
        });

      expect(res1.status).toBe(201);
      const originalSaleId = res1.body.id;

      // Stock should now be 7
      const [batchAfterFirst]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          batchId
        )
      );
      expect(Number(batchAfterFirst.quantity_units_remaining)).toBe(7);

      // Replay identical submission with same offlineId
      const res2 = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          offlineId,
          items: [{ inventoryItemId: invId, unitType: 'PACK', quantity: 3 }],
          discountAmount: 0,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(originalSaleId);
      expect(res2.body.isIdempotentReplay).toBe(true);

      // Stock MUST REMAIN 7 (no second deduction!)
      const [batchAfterSecond]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          batchId
        )
      );
      expect(Number(batchAfterSecond.quantity_units_remaining)).toBe(7);
    });
  });

  // =========================================================================
  // SCENARIO 9: branch switching (User Identity Preservation Across Branches)
  // =========================================================================
  describe('Scenario 9: branch switching (User Identity Preservation Across Branches)', () => {
    it('should switch branch context while maintaining identical user ID, username, and role', async () => {
      // Ensure tenantA and tenantB share a chain
      const chains: any[] = await safeDb(() => prisma.$queryRawUnsafe(`SELECT id FROM public.chains LIMIT 1`));
      let chainId = chains.length > 0 ? chains[0].id : null;

      if (!chainId) {
        chainId = crypto.randomUUID();
        await safeDb(() =>
          prisma.$executeRawUnsafe(
            `INSERT INTO public.chains (id, name, created_at, updated_at) VALUES ($1::uuid, 'Test Chain 9', NOW(), NOW())`,
            chainId
          )
        );
      }

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(`UPDATE public.tenants SET chain_id = $1::uuid WHERE id = $2::uuid`, chainId, tenantA.id);
        await prisma.$executeRawUnsafe(`UPDATE public.tenants SET chain_id = $1::uuid WHERE id = $2::uuid`, chainId, tenantB.id);
      });

      const switchRes = await request(API_URL)
        .post('/api/auth/switch-branch')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetTenantId: tenantB.id });

      expect(switchRes.status).toBe(200);
      expect(switchRes.body.user.id).toBe(ownerA.id);
      expect(switchRes.body.user.username).toBe(ownerA.username);
      expect(switchRes.body.user.role).toBe('OWNER');

      const switchedToken = switchRes.body.accessToken;

      // Validate session with switched token
      const meRes = await request(API_URL)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${switchedToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.sub).toBe(ownerA.id);
      expect(meRes.body.tenantId).toBe(tenantB.id);
      expect(meRes.body.schemaName).toBe(tenantB.schemaName);
    });
  });

  // =========================================================================
  // SCENARIO 10: tenant isolation (Cross-Tenant Data Segregation)
  // =========================================================================
  describe('Scenario 10: tenant isolation (Cross-Tenant Data Segregation)', () => {
    it('should strictly isolate data and prevent Tenant B from reading or modifying Tenant A records', async () => {
      // Create a sale in Tenant A
      const medA = await safeDb(() =>
        prisma.medicine.create({
          data: {
            tradeName: `Med_TenantA_${Date.now()}`,
            scientificName: 'Tenant A Secret Drug',
            defaultUnitsPerPack: 1,
          },
        })
      );

      const invIdA = crypto.randomUUID();
      const batchIdA = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'ItemA', 1, 5000, 5000)`,
          invIdA,
          medA.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-A-SECRET', 5, 2000, NOW() + INTERVAL '1 year')`,
          batchIdA,
          invIdA
        );
      });

      const saleResA = await request(API_URL)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          items: [{ inventoryItemId: invIdA, unitType: 'PACK', quantity: 2 }],
          discountAmount: 0,
        });

      expect(saleResA.status).toBe(201);
      const saleIdA = saleResA.body.id;

      // Tenant B attempts to fetch Tenant A's sale
      const getSaleResB = await request(API_URL)
        .get(`/api/pos/sales/${saleIdA}`)
        .set('Authorization', `Bearer ${tokenB}`);

      // Must be 404 Not Found (cannot see Tenant A's sale)
      expect(getSaleResB.status).toBe(404);

      // Tenant B attempts to return against Tenant A's sale
      const returnResB = await request(API_URL)
        .post('/api/pos/return')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          saleId: saleIdA,
          items: [{ inventoryItemId: invIdA, quantity: 1, unitType: 'PACK' }],
          reason: 'Cross tenant attack attempt',
        });

      expect(returnResB.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // SCENARIO 11: stocktake reconciliation (Stocktake Discrepancy Adjustment)
  // =========================================================================
  describe('Scenario 11: stocktake reconciliation (Stocktake Discrepancy Adjustment)', () => {
    it('should reconcile stocktake shortages and surpluses, updating inventory batches atomically and marking session COMPLETED', async () => {
      // 1. Seed Item 1 (for Shortage: 10 in stock, counted 7 -> -3 units)
      const med1 = await safeDb(() =>
        prisma.medicine.create({ data: { tradeName: `Stocktake_Short_${Date.now()}`, scientificName: 'Short Med', defaultUnitsPerPack: 1 } })
      );
      const inv1 = crypto.randomUUID();
      const b1 = crypto.randomUUID();

      // 2. Seed Item 2 (for Surplus: 5 in stock, counted 8 -> +3 units)
      const med2 = await safeDb(() =>
        prisma.medicine.create({ data: { tradeName: `Stocktake_Surplus_${Date.now()}`, scientificName: 'Surplus Med', defaultUnitsPerPack: 1 } })
      );
      const inv2 = crypto.randomUUID();
      const b2 = crypto.randomUUID();

      await safeDb(async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'ShortItem', 1, 1000, 1000)`,
          inv1,
          med1.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-ST-SHORT', 10, 500, NOW() + INTERVAL '1 year')`,
          b1,
          inv1
        );

        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_items (id, medicine_id, custom_name, units_per_pack, selling_price_pack, selling_price_unit)
             VALUES ($1::uuid, $2::uuid, 'SurplusItem', 1, 1200, 1200)`,
          inv2,
          med2.id
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${tenantA.schemaName}".inventory_batches (id, inventory_item_id, batch_number, quantity_units_remaining, purchase_price_pack, expiry_date)
             VALUES ($1::uuid, $2::uuid, 'BATCH-ST-SURPLUS', 5, 600, NOW() + INTERVAL '1 year')`,
          b2,
          inv2
        );
      });

      // 3. Create Stocktake Session via API
      const sessionRes = await request(API_URL)
        .post('/api/stocktake/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: 'جلسة تسوية الجرد الآلية', notes: 'Automated E2E Reconciliation Test' });

      expect(sessionRes.status).toBe(201);
      const sessionId = sessionRes.body.sessionId || sessionRes.body.id;

      // 4. Update stocktake_items to simulate counts
      await safeDb(async () => {
        // Shortage: counted 7 (variance -3)
        await prisma.$executeRawUnsafe(
          `UPDATE "${tenantA.schemaName}".stocktake_items
             SET counted_total_units = 7, counted_packs = 7, variance_units = -3, variance_packs = -3, 
                 variance_status = 'SHORTAGE', counted_at = NOW()
             WHERE session_id = $1::uuid AND inventory_item_id = $2::uuid`,
          sessionId,
          inv1
        );

        // Surplus: counted 8 (variance +3)
        await prisma.$executeRawUnsafe(
          `UPDATE "${tenantA.schemaName}".stocktake_items
             SET counted_total_units = 8, counted_packs = 8, variance_units = 3, variance_packs = 3, 
                 variance_status = 'SURPLUS', counted_at = NOW()
             WHERE session_id = $1::uuid AND inventory_item_id = $2::uuid`,
          sessionId,
          inv2
        );
      });

      // 5. Call reconcile endpoint
      const reconcileRes = await request(API_URL)
        .post(`/api/stocktake/sessions/${sessionId}/reconcile`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ notes: 'اعتماد الفروقات بنجاح' });

      expect(reconcileRes.status).toBe(201);
      expect(reconcileRes.body.success).toBe(true);

      // 6. Assert DB state:
      const [b1Row]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          b1
        )
      );
      expect(Number(b1Row.quantity_units_remaining)).toBe(7);

      const [b2Row]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT quantity_units_remaining FROM "${tenantA.schemaName}".inventory_batches WHERE id = $1::uuid`,
          b2
        )
      );
      expect(Number(b2Row.quantity_units_remaining)).toBe(8);

      const [sessionRow]: any[] = await safeDb(() =>
        prisma.$queryRawUnsafe(
          `SELECT status FROM "${tenantA.schemaName}".stocktake_sessions WHERE id = $1::uuid`,
          sessionId
        )
      );
      expect(sessionRow.status).toBe('COMPLETED');
    });
  });
});
