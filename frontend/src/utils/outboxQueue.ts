/**
 * Unified Outbox Queue Engine for Dawaee Offline Operations.
 * Handles queuing, status tracking, retries, and background syncing for:
 * - SALE
 * - RETURN
 * - PURCHASE
 * - EXPENSE
 */

import { getLocalMasterDb } from './localDatabase';
import { apiRequest } from '../api/client';

export type OutboxOpType = 'SALE' | 'RETURN' | 'PURCHASE' | 'EXPENSE';
export type OutboxStatus = 'PENDING' | 'SYNCING' | 'DONE' | 'FAILED';

export interface OutboxItem {
  id: string; // UUID / timestamp unique key
  type: OutboxOpType;
  endpoint: string; // API endpoint (e.g. /pos/sync-offline, /pos/returns, /purchases, /expenses)
  method: 'POST' | 'PUT' | 'PATCH';
  payload: any;
  createdAt: string;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
}

/**
 * Add a new operation to the outbox queue
 */
export async function queueOutboxOperation(
  type: OutboxOpType,
  endpoint: string,
  payload: any,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST'
): Promise<OutboxItem> {
  const db = await getLocalMasterDb();
  const item: OutboxItem = {
    id: `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type,
    endpoint,
    method,
    payload,
    createdAt: new Date().toISOString(),
    status: 'PENDING',
    retryCount: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox_operations', 'readwrite');
    const store = tx.objectStore('outbox_operations');
    store.put(item);

    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all pending operations in outbox
 */
export async function getPendingOutboxOperations(): Promise<OutboxItem[]> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox_operations', 'readonly');
    const store = tx.objectStore('outbox_operations');
    const req = store.getAll();

    req.onsuccess = () => {
      const items: OutboxItem[] = req.result || [];
      const pending = items.filter((i) => i.status === 'PENDING' || i.status === 'FAILED');
      // Sort by creation time (FIFO)
      pending.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      resolve(pending);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Update the status of an outbox operation
 */
export async function updateOutboxStatus(
  id: string,
  status: OutboxStatus,
  errorMsg?: string
): Promise<void> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox_operations', 'readwrite');
    const store = tx.objectStore('outbox_operations');
    const req = store.get(id);

    req.onsuccess = () => {
      const item: OutboxItem = req.result;
      if (item) {
        item.status = status;
        if (status === 'FAILED') {
          item.retryCount = (item.retryCount || 0) + 1;
          item.lastError = errorMsg;
        }
        store.put(item);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete a completed outbox operation
 */
export async function removeOutboxOperation(id: string): Promise<void> {
  const db = await getLocalMasterDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox_operations', 'readwrite');
    const store = tx.objectStore('outbox_operations');
    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Single-pass Background Sync Worker function
 * Sends pending operations to the cloud when online
 */
export async function processOutboxQueue(): Promise<{ syncedCount: number; failedCount: number }> {
  if (!navigator.onLine) {
    return { syncedCount: 0, failedCount: 0 };
  }

  const pending = await getPendingOutboxOperations();
  if (pending.length === 0) {
    return { syncedCount: 0, failedCount: 0 };
  }

  let syncedCount = 0;
  let failedCount = 0;

  for (const op of pending) {
    if (!navigator.onLine) break; // Network lost mid-sync

    await updateOutboxStatus(op.id, 'SYNCING');

    try {
      await apiRequest(op.endpoint, {
        method: op.method,
        body: JSON.stringify(op.payload),
      });

      await removeOutboxOperation(op.id);

      // Clean up pending_sales store in IndexedDB if op was a SALE
      if (op.type === 'SALE' && op.payload?.sales && Array.isArray(op.payload.sales)) {
        const { removePendingSale } = await import('./localDatabase');
        for (const sItem of op.payload.sales) {
          if (sItem.offlineId) {
            await removePendingSale(sItem.offlineId).catch(() => {});
          }
        }
      }

      syncedCount++;
    } catch (err: any) {
      console.warn(`Outbox operation ${op.id} (${op.type}) sync failed:`, err);
      // If server returned 4xx or 5xx, or network error
      const isPermanentError = err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
      if (isPermanentError) {
        // Mark as failed permanently or set retry
        await updateOutboxStatus(op.id, 'FAILED', err.message || 'خطأ في معالجة السيرفر');
      } else {
        // Network or server temporary error — revert to PENDING for retry
        await updateOutboxStatus(op.id, 'PENDING', err.message || 'انقطع الاتصال');
      }
      failedCount++;
    }
  }

  return { syncedCount, failedCount };
}
