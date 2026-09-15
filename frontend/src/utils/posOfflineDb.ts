/**
 * Unified Offline-First Storage Engine for Dawaee POS using single master IndexedDB (dawaee_local_master_db).
 * Re-exports from localDatabase.ts to ensure 100% backward compatibility across views.
 */

export {
  getLocalMasterDb as getPosOfflineDb,
  cacheInventoryLocally,
  searchLocalInventory,
  deductLocalInventoryStock,
  saveOfflineSale,
  getPendingSales,
  removePendingSale,
  generateOfflineInvoiceNumber,
  type OfflineSaleRecord,
  type OfflineSaleBatchAllocation,
} from './localDatabase';
