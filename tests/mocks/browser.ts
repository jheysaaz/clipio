/**
 * Shared browser extension API mocks for Vitest.
 *
 * Provides in-memory implementations of:
 *   - browser.storage.sync
 *   - browser.storage.local
 *   - browser.runtime
 *
 * Call `resetBrowserMocks()` in `beforeEach` to clear state between tests.
 *
 * Usage:
 *   import { resetBrowserMocks } from "tests/mocks/browser";
 *   beforeEach(() => resetBrowserMocks());
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory storage stores
// ---------------------------------------------------------------------------

let syncStore: Record<string, unknown> = {};
let localStore: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// browser.storage.sync mock
// ---------------------------------------------------------------------------

export const mockStorageSync = {
  get: vi.fn(
    async (keys: string | string[] | null | Record<string, unknown>) => {
      if (keys === null) {
        return { ...syncStore };
      }
      if (typeof keys === "string") {
        return syncStore[keys] !== undefined ? { [keys]: syncStore[keys] } : {};
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          if (syncStore[k] !== undefined) result[k] = syncStore[k];
        }
        return result;
      }
      // Object form — return defaults merged with stored values
      const result: Record<string, unknown> = {};
      for (const [k, defaultVal] of Object.entries(keys)) {
        result[k] = syncStore[k] !== undefined ? syncStore[k] : defaultVal;
      }
      return result;
    }
  ),

  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(syncStore, items);
  }),

  remove: vi.fn(async (keys: string | string[]) => {
    const toRemove = typeof keys === "string" ? [keys] : keys;
    for (const k of toRemove) {
      delete syncStore[k];
    }
  }),

  getBytesInUse: vi.fn(async () => 0),

  QUOTA_BYTES: 102400,
  QUOTA_BYTES_PER_ITEM: 8192,
  MAX_ITEMS: 512,
  MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
  MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
};

// ---------------------------------------------------------------------------
// browser.storage.local mock
// ---------------------------------------------------------------------------

export const mockStorageLocal = {
  get: vi.fn(
    async (keys: string | string[] | null | Record<string, unknown>) => {
      if (keys === null) {
        return { ...localStore };
      }
      if (typeof keys === "string") {
        return localStore[keys] !== undefined
          ? { [keys]: localStore[keys] }
          : {};
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          if (localStore[k] !== undefined) result[k] = localStore[k];
        }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const [k, defaultVal] of Object.entries(keys)) {
        result[k] = localStore[k] !== undefined ? localStore[k] : defaultVal;
      }
      return result;
    }
  ),

  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(localStore, items);
  }),

  remove: vi.fn(async (keys: string | string[]) => {
    const toRemove = typeof keys === "string" ? [keys] : keys;
    for (const k of toRemove) {
      delete localStore[k];
    }
  }),

  getBytesInUse: vi.fn(async () => 0),
};

// ---------------------------------------------------------------------------
// browser.runtime mock
// ---------------------------------------------------------------------------

export const mockRuntime = {
  id: "test-extension-id",
  sendMessage: vi.fn(async () => undefined),
  getManifest: vi.fn(() => ({
    name: "Clipio",
    version: "0.0.0",
    manifest_version: 3,
  })),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  onInstalled: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  lastError: undefined as Error | undefined,
};

// ---------------------------------------------------------------------------
// browser global mock
// ---------------------------------------------------------------------------

export const mockBrowser = {
  storage: {
    sync: mockStorageSync,
    local: mockStorageLocal,
  },
  runtime: mockRuntime,
};

// ---------------------------------------------------------------------------
// WXT storage item factory mock
// Creates an in-memory typed storage item compatible with the WXT API shape.
// ---------------------------------------------------------------------------

export function createMockStorageItem<T>(defaultValue: T) {
  let storedValue: T = defaultValue;
  const watchers: Array<(value: T) => void> = [];

  return {
    getValue: vi.fn(async (): Promise<T> => storedValue),
    setValue: vi.fn(async (value: T): Promise<void> => {
      storedValue = value;
      for (const watcher of watchers) {
        watcher(value);
      }
    }),
    removeValue: vi.fn(async (): Promise<void> => {
      storedValue = defaultValue;
      for (const watcher of watchers) {
        watcher(defaultValue);
      }
    }),
    watch: vi.fn((callback: (value: T) => void) => {
      watchers.push(callback);
      return () => {
        const idx = watchers.indexOf(callback);
        if (idx !== -1) watchers.splice(idx, 1);
      };
    }),
    // Test-only helper: directly set the stored value without triggering watchers
    _setRaw: (value: T) => {
      storedValue = value;
    },
    // Test-only helper: read the current stored value synchronously
    _getRaw: () => storedValue,
  };
}

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

/** Clears all in-memory storage stores and resets all mock call counts. */
export function resetBrowserMocks() {
  syncStore = {};
  localStore = {};

  // Reset call history on all mocks
  mockStorageSync.get.mockClear();
  mockStorageSync.set.mockClear();
  mockStorageSync.remove.mockClear();
  mockStorageSync.getBytesInUse.mockClear();

  mockStorageLocal.get.mockClear();
  mockStorageLocal.set.mockClear();
  mockStorageLocal.remove.mockClear();
  mockStorageLocal.getBytesInUse.mockClear();

  mockRuntime.sendMessage.mockClear();
  mockRuntime.getManifest.mockClear();
  mockRuntime.onMessage.addListener.mockClear();
  mockRuntime.onMessage.removeListener.mockClear();
}

/** Simulate a storage.sync quota error on the next `set` call. */
export function simulateSyncQuotaError() {
  mockStorageSync.set.mockRejectedValueOnce(
    new Error("QUOTA_BYTES_PER_ITEM quota exceeded")
  );
}

/** Directly populate the sync store (bypasses mock tracking). */
export function seedSyncStore(data: Record<string, unknown>) {
  Object.assign(syncStore, data);
}

/** Directly populate the local store (bypasses mock tracking). */
export function seedLocalStore(data: Record<string, unknown>) {
  Object.assign(localStore, data);
}
