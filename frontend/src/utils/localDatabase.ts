/**
 * Pure Local-First Database Engine for Dawaee Pharmacy System (IndexedDB)
 * Ensures 100% offline autonomy: full inventory, suppliers, sales history,
 * and offline sync queues stored directly on the machine's browser/disk.
 */

const DB_NAME = 'dawaee_local_master_db';
const DB_VERSION = 2;

export interface LocalInventoryItem {
  id: string;
  medicineId: string;
  customName?: string;
  tradeName: string;
  scientificName: string;
  unitsPerPack: number;
  sellingPricePack: number;
  sellingPriceUnit: number;
  purchasePricePack?: number;
  availablePacks: number;
  availableStrips: number;
  totalUnitsRemaining: number;
  minAlertUnits?: number;
  barcode?: string;
  dosageForm?: string;
  strength?: string;
  manufacturer?: string;
  supplierId?: string;
  supplierName?: string;
  activeBatches?: any[];
}

export interface LocalSupplier {
  id: string;
  name: string;
  phone?: string;
  totalDebt?: number;
}

export interface LocalSaleRecord {
  offlineId: string;
  invoiceNumber: string;
  items: any[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  createdAt: string;
  cashierName?: string;
  isSynced: boolean;
}

let dbInstance: IDBDatabase | null = null;

export function getLocalMasterDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase;

      if (!db.objectStoreNames.contains('inventory')) {
        const invStore = db.createObjectStore('inventory', { keyPath: 'id' });
        invStore.createIndex('tradeName', 'tradeName', { unique: false });
        invStore.createIndex('barcode', 'barcode', { unique: false });
      }

      if (!db.objectStoreNames.contains('suppliers')) {
        db.createObjectStore('suppliers', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('pending_sales')) {
        db.createObjectStore('pending_sales', { keyPath: 'offlineId' });
      }

      if (!db.objectStoreNames.contains('sales_history')) {
        const salesStore = db.createObjectStore('sales_history', { keyPath: 'offlineId' });
        salesStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = (event: any) => {
      dbInstance = event.target.result as IDBDatabase;
      resolve(dbInstance);
    };

    request.onerror = (event: any) => {
      reject(event.target.error);
    };
  });
}

/**
 * Save / Replace all inventory items locally in IndexedDB
 */
export async function saveLocalInventoryBulk(items: LocalInventoryItem[]): Promise<void> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory', 'readwrite');
    const store = tx.objectStore('inventory');

    store.clear();
    for (const item of items) {
      store.put(item);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all inventory items directly from local storage with filtering & search
 */
export async function getLocalInventory(filters?: {
  search?: string;
  filter?: 'ALL' | 'LOW_STOCK' | 'EXPIRING_SOON';
  supplierId?: string;
}): Promise<{ items: LocalInventoryItem[]; summary: { total: number; lowStock: number; expiring: number } }> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory', 'readonly');
    const store = tx.objectStore('inventory');
    const req = store.getAll();

    req.onsuccess = () => {
      const allItems: LocalInventoryItem[] = req.result || [];
      const now = new Date();
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(now.getMonth() + 3);

      let lowStockCount = 0;
      let expiringCount = 0;

      for (const item of allItems) {
        const minAlert = Number(item.minAlertUnits || 5);
        if (Number(item.totalUnitsRemaining || 0) <= minAlert) {
          lowStockCount++;
        }

        if (item.activeBatches && Array.isArray(item.activeBatches)) {
          for (const b of item.activeBatches) {
            if (b.expiryFormatted) {
              const exp = new Date(b.expiryFormatted);
              if (exp <= threeMonthsFromNow) {
                expiringCount++;
                break;
              }
            }
          }
        }
      }

      let filtered = allItems;

      if (filters?.supplierId) {
        filtered = filtered.filter((it) => it.supplierId === filters.supplierId);
      }

      if (filters?.search && filters.search.trim().length > 0) {
        const term = filters.search.trim().toLowerCase();
        filtered = filtered.filter((it) => {
          const tName = (it.tradeName || '').toLowerCase();
          const sName = (it.scientificName || '').toLowerCase();
          const bCode = (it.barcode || '').toLowerCase();
          const cName = (it.customName || '').toLowerCase();
          return tName.includes(term) || sName.includes(term) || bCode.includes(term) || cName.includes(term);
        });
      }

      if (filters?.filter === 'LOW_STOCK') {
        filtered = filtered.filter((it) => {
          const minAlert = Number(it.minAlertUnits || 5);
          return Number(it.totalUnitsRemaining || 0) <= minAlert;
        });
      } else if (filters?.filter === 'EXPIRING_SOON') {
        filtered = filtered.filter((it) => {
          if (!it.activeBatches || !Array.isArray(it.activeBatches)) return false;
          return it.activeBatches.some((b) => {
            if (!b.expiryFormatted) return false;
            return new Date(b.expiryFormatted) <= threeMonthsFromNow;
          });
        });
      }

      resolve({
        items: filtered,
        summary: {
          total: allItems.length,
          lowStock: lowStockCount,
          expiring: expiringCount,
        },
      });
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Save suppliers locally
 */
export async function saveLocalSuppliers(suppliers: LocalSupplier[]): Promise<void> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('suppliers', 'readwrite');
    const store = tx.objectStore('suppliers');
    store.clear();
    for (const s of suppliers) {
      store.put(s);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get cached suppliers list locally
 */
export async function getLocalSuppliers(): Promise<LocalSupplier[]> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('suppliers', 'readonly');
    const store = tx.objectStore('suppliers');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deduct stock locally from IndexedDB when an offline/local sale occurs
 */
export async function deductLocalStockDirectly(cartItems: any[]): Promise<void> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory', 'readwrite');
    const store = tx.objectStore('inventory');

    for (const cartItem of cartItems) {
      const req = store.get(cartItem.inventoryItemId);
      req.onsuccess = () => {
        const item = req.result as LocalInventoryItem;
        if (item) {
          const isPack = cartItem.unitType === 'PACK';
          const unitsPerPack = Number(item.unitsPerPack) || 1;
          const unitsToDeduct = isPack ? cartItem.quantity * unitsPerPack : cartItem.quantity;

          item.totalUnitsRemaining = Math.max(0, (item.totalUnitsRemaining || 0) - unitsToDeduct);
          item.availablePacks = Math.floor(item.totalUnitsRemaining / unitsPerPack);
          item.availableStrips = item.totalUnitsRemaining % unitsPerPack;

          if (item.activeBatches && Array.isArray(item.activeBatches)) {
            let left = unitsToDeduct;
            for (const b of item.activeBatches) {
              if (left <= 0) break;
              const avail = Number(b.quantityUnitsRemaining) || 0;
              const deduct = Math.min(avail, left);
              b.quantityUnitsRemaining = Math.max(0, avail - deduct);
              b.availablePacks = Math.floor(b.quantityUnitsRemaining / unitsPerPack);
              b.availableStrips = b.quantityUnitsRemaining % unitsPerPack;
              left -= deduct;
            }
          }

          store.put(item);
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Record a sale locally in both pending sync queue and local sales history
 */
export async function recordLocalSale(sale: {
  offlineId: string;
  invoiceNumber: string;
  payload: any;
  items: any[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  createdAt: string;
  cashierName?: string;
  isSynced: boolean;
}): Promise<void> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pending_sales', 'sales_history'], 'readwrite');
    const pendingStore = tx.objectStore('pending_sales');
    const historyStore = tx.objectStore('sales_history');

    if (!sale.isSynced) {
      pendingStore.put({
        offlineId: sale.offlineId,
        invoiceNumber: sale.invoiceNumber,
        payload: sale.payload,
        displayItems: sale.items,
        subtotal: sale.subtotal,
        discountAmount: sale.discountAmount,
        totalAmount: sale.totalAmount,
        createdAt: sale.createdAt,
        cashierName: sale.cashierName,
      });
    }

    historyStore.put(sale);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get local daily summary for cashier shifts when offline
 */
export async function getLocalDailySummary(): Promise<any> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sales_history', 'readonly');
    const store = tx.objectStore('sales_history');
    const req = store.getAll();

    req.onsuccess = () => {
      const sales: LocalSaleRecord[] = req.result || [];
      const todayStr = new Date().toISOString().slice(0, 10);
      const todaySales = sales.filter((s) => s.createdAt.startsWith(todayStr));

      const totalInvoices = todaySales.length;
      const totalSalesRevenue = todaySales.reduce((sum, s) => sum + Number(s.subtotal || 0), 0);
      const totalDiscounts = todaySales.reduce((sum, s) => sum + Number(s.discountAmount || 0), 0);
      const netCashInDrawer = todaySales.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0);

      resolve({
        totalInvoices,
        totalSalesRevenue,
        totalDiscounts,
        totalRefunds: 0,
        netCashInDrawer,
      });
    };

    req.onerror = () => reject(req.error);
  });
}
