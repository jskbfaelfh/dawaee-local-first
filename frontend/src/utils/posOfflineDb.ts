/**
 * Offline-First Storage Engine for Dawaee POS using browser IndexedDB.
 * Allows instant 0ms searches, offline transactions, and local invoice queueing.
 */

const DB_NAME = 'dawaee_pos_offline_db';
const DB_VERSION = 1;

export interface OfflineSaleBatchAllocation {
  inventoryItemId: string;
  batchId?: string;
  batchNumber?: string;
  units: number;
  unitPrice: number;
  costPricePack?: number;
}

export interface OfflineSaleRecord {
  offlineId: string;
  invoiceNumber: string;
  payload: {
    discountAmount: number;
    items: {
      inventoryItemId: string;
      inventoryBatchId?: string;
      unitType: string;
      quantity: number;
    }[];
    allocatedBatches?: OfflineSaleBatchAllocation[];
  };
  displayItems: any[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  createdAt: string;
  cashierName?: string;
}

let dbInstance: IDBDatabase | null = null;

export function getPosOfflineDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase;

      if (!db.objectStoreNames.contains('inventory_cache')) {
        const invStore = db.createObjectStore('inventory_cache', { keyPath: 'id' });
        invStore.createIndex('tradeName', 'tradeName', { unique: false });
        invStore.createIndex('barcode', 'barcode', { unique: false });
      }

      if (!db.objectStoreNames.contains('pending_sales')) {
        db.createObjectStore('pending_sales', { keyPath: 'offlineId' });
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
 * Cache all active inventory items locally
 */
export async function cacheInventoryLocally(items: any[]): Promise<void> {
  const db = await getPosOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory_cache', 'readwrite');
    const store = tx.objectStore('inventory_cache');

    store.clear();
    for (const item of items) {
      store.put(item);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Search cached inventory items locally by tradeName, scientificName, barcode, or customName
 */
export async function searchLocalInventory(searchTerm: string): Promise<any[]> {
  const db = await getPosOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory_cache', 'readonly');
    const store = tx.objectStore('inventory_cache');
    const req = store.getAll();

    req.onsuccess = () => {
      const allItems: any[] = req.result || [];
      if (!searchTerm || searchTerm.trim().length === 0) {
        resolve(allItems.slice(0, 30));
        return;
      }

      const term = searchTerm.trim().toLowerCase();
      const filtered = allItems.filter((item) => {
        const tName = (item.tradeName || '').toLowerCase();
        const sName = (item.scientificName || '').toLowerCase();
        const bCode = (item.barcode || '').toLowerCase();
        const cName = (item.customName || '').toLowerCase();

        return (
          tName.includes(term) ||
          sName.includes(term) ||
          bCode.includes(term) ||
          cName.includes(term)
        );
      });

      resolve(filtered.slice(0, 40));
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Deduct stock locally in IndexedDB when an offline sale occurs.
 * Strictly prevents overselling: throws an error if requested quantity exceeds local stock.
 */
export async function deductLocalInventoryStock(cartItems: any[]): Promise<void> {
  const db = await getPosOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inventory_cache', 'readwrite');
    const store = tx.objectStore('inventory_cache');

    for (const cartItem of cartItems) {
      const req = store.get(cartItem.inventoryItemId);
      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          const isPack = cartItem.unitType === 'PACK';
          const unitsPerPack = Number(item.unitsPerPack) || 1;
          const unitsToDeduct = isPack ? cartItem.quantity * unitsPerPack : cartItem.quantity;
          const currentTotal = Number(item.totalUnitsRemaining) || 0;

          if (unitsToDeduct > currentTotal) {
            tx.abort();
            reject(new Error(`الكمية المطلوبة من دواء (${item.tradeName}) تتجاوز الرصيد المحلي المتاح (${currentTotal} وحدة).`));
            return;
          }

          item.totalUnitsRemaining = currentTotal - unitsToDeduct;
          item.availablePacks = Math.floor(item.totalUnitsRemaining / unitsPerPack);
          item.availableStrips = item.totalUnitsRemaining % unitsPerPack;

          // Also deduct from activeBatches if present
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
 * Save an offline sale to the pending sync queue
 */
export async function saveOfflineSale(sale: OfflineSaleRecord): Promise<void> {
  const db = await getPosOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sales', 'readwrite');
    const store = tx.objectStore('pending_sales');
    store.put(sale);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve all pending offline sales that need to be synced to the cloud
 */
export async function getPendingSales(): Promise<OfflineSaleRecord[]> {
  const db = await getPosOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sales', 'readonly');
    const store = tx.objectStore('pending_sales');
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove a specific offline sale once successfully synced
 */
export async function removePendingSale(offlineId: string): Promise<void> {
  const db = await getPosOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sales', 'readwrite');
    const store = tx.objectStore('pending_sales');
    store.delete(offlineId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Generate a unique local offline invoice number
 */
export function generateOfflineInvoiceNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `OFFLINE-${dateStr}-${randomSuffix}`;
}
