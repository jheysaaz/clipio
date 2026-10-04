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
// chrome.* mock — a real message bus
// ---------------------------------------------------------------------------
//
// WHY THIS IS NOT AN ALIAS OF `browser`
//
// `@webext-core/messaging` calls `chrome.runtime.sendMessage(message, callback)`
// and `chrome.tabs.sendMessage(tabId, message, callback)`. That is the
// **callback** form, whereas `browser.*` is the **promise** form — the split
// between the two WebExtension API dialects. Aliasing `chrome` to `browser`
// would type-check and then hang forever: the promise-based mock ignores the
// callback the library hands it, so the promise the library awaits never
// settles and the test times out with no explanation.
//
// So this is a separate mock that speaks the callback protocol and genuinely
// dispatches to registered listeners. That is worth more than an alias: a unit
// test can now send a message and get a real response through a real handler,
// which is the only way to catch a protocol that has drifted between its sender
// and its receiver.

type ChromeListener = (
  message: unknown,
  sender: { id?: string; tab?: { id: number } },
  sendResponse: (response: unknown) => void
) => boolean | undefined | void;

const chromeRuntimeListeners: ChromeListener[] = [];

/**
 * Deliver a message the way Chrome does.
 *
 * Listeners run in registration order until one returns `true` — Chrome's
 * signal that it will answer asynchronously. Anything else means the listener
 * declined and the next one is tried. A listener that throws is swallowed, as
 * Chrome swallows it.
 */
function dispatchChromeMessage(
  message: unknown,
  sender: { id?: string; tab?: { id: number } }
): Promise<unknown> {
  return new Promise((resolve) => {
    for (const listener of [...chromeRuntimeListeners]) {
      let settled = false;
      const sendResponse = (response: unknown) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };

      let claimed: boolean | undefined | void;
      try {
        claimed = listener(message, sender, sendResponse);
      } catch {
        claimed = undefined;
      }

      if (claimed === true) return;
      if (settled) return;
    }
    // Nobody claimed it. Chrome reports this as "no receiving end"; resolving
    // with undefined lets the library's own `?? { err }` fallback take over.
    resolve(undefined);
  });
}

const EXTENSION_ID = "test-extension-id";

export const mockChromeRuntime = {
  id: EXTENSION_ID,
  lastError: undefined as { message: string } | undefined,
  sendMessage: vi.fn(
    (message: unknown, callback?: (response: unknown) => void) => {
      const promise = dispatchChromeMessage(message, { id: EXTENSION_ID });
      if (typeof callback === "function") {
        promise.then((response) => callback(response));
        return undefined;
      }
      return promise;
    }
  ),
  onMessage: {
    addListener: vi.fn((fn: ChromeListener) => {
      chromeRuntimeListeners.push(fn);
    }),
    removeListener: vi.fn((fn: ChromeListener) => {
      const i = chromeRuntimeListeners.indexOf(fn);
      if (i !== -1) chromeRuntimeListeners.splice(i, 1);
    }),
    hasListener: vi.fn((fn: ChromeListener) =>
      chromeRuntimeListeners.includes(fn)
    ),
  },
};

export const mockChromeTabs = {
  sendMessage: vi.fn(
    (
      tabId: number,
      message: unknown,
      frameIdOrOptions?: unknown,
      callback?: (response: unknown) => void
    ) => {
      // A content script in that tab. It sees `sender.id` as the extension's own
      // id and `sender.tab.id` as the tab — the case the sender check has to
      // accept, alongside the background reaching it.
      void frameIdOrOptions;
      const promise = dispatchChromeMessage(message, {
        id: EXTENSION_ID,
        tab: { id: tabId },
      });
      if (typeof callback === "function") {
        promise.then((response) => callback(response));
        return undefined;
      }
      return promise;
    }
  ),
};

export const mockChrome = { runtime: mockChromeRuntime, tabs: mockChromeTabs };

// ---------------------------------------------------------------------------
// browser global mock
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// browser.tabs mock
// ---------------------------------------------------------------------------

export const mockTabs = {
  create: vi.fn(async (_props: { url: string }) => ({ id: 1 })),
  query: vi.fn(async (_query?: unknown) => [] as unknown[]),
  sendMessage: vi.fn(async () => undefined),
};

export const mockBrowser = {
  storage: {
    sync: mockStorageSync,
    local: mockStorageLocal,
  },
  runtime: mockRuntime,
  tabs: mockTabs,
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

  mockTabs.create.mockClear();
  mockTabs.query.mockClear();
  mockTabs.sendMessage.mockClear();

  // Call history only. The `chrome` listener list is deliberately NOT cleared:
  // `@webext-core/messaging` installs one root listener the first time any
  // handler is registered and caches the remover, so emptying the list behind
  // its back would leave it believing it is still subscribed while answering
  // nothing — a silently broken messenger in every test after the first. Use
  // `resetChromeMessageBus()` when a test genuinely needs a clean bus.
  mockChromeRuntime.sendMessage.mockClear();
  mockChromeRuntime.onMessage.addListener.mockClear();
  mockChromeRuntime.onMessage.removeListener.mockClear();
  mockChromeRuntime.onMessage.hasListener.mockClear();
  mockChromeTabs.sendMessage.mockClear();
}

/**
 * Deliver a message to the registered listeners with a caller-chosen `sender`.
 *
 * The public `chrome.runtime.sendMessage` mock always presents this extension
 * as the sender, because that is the only thing extension code can do. Testing
 * the *sender check* needs the other case: a hostile web page posting to
 * `runtime.onMessage` with our extension's id and a type name it guessed.
 *
 * Resolves with what the listener handed to `sendResponse`, which for
 * `@webext-core/messaging` is the internal `{ res }` / `{ err }` envelope —
 * deliberately not unwrapped, since a test asserting on the refusal needs to see
 * the shape that actually crosses the wire.
 */
export function dispatchToChromeListeners(
  message: unknown,
  sender: { id?: string; tab?: { id: number } } = { id: EXTENSION_ID }
): Promise<unknown> {
  return dispatchChromeMessage(message, sender);
}

/**
 * How many times the messenger has installed its root listener.
 *
 * The protocol multiplexes every message type through one
 * `runtime.onMessage` listener, which is what lets unrelated handlers coexist.
 * Asserting the count is how that property is tested; reaching for `chrome`
 * directly from a test would not type-check, since `chrome` is only present as a
 * mocked global.
 */
export function chromeListenerRegistrationCount(): number {
  return (
    mockChromeRuntime.onMessage.addListener as unknown as {
      mock: { calls: unknown[][] };
    }
  ).mock.calls.length;
}

/**
 * Drop every registered `chrome.runtime.onMessage` listener.
 *
 * Only for tests that register their own handler and need a clean bus. Clearing
 * this while the shared `messenger` believes it is subscribed breaks every
 * later message in the file — see the note in `resetBrowserMocks`.
 */
export function resetChromeMessageBus(): void {
  chromeRuntimeListeners.length = 0;
}

/** Simulate a storage.sync quota error on the next `set` call. */
export function simulateSyncQuotaError() {
  mockStorageSync.set.mockRejectedValueOnce(
    new Error("QUOTA_BYTES_PER_ITEM quota exceeded")
  );
}

/**
 * A *sustained* quota failure, which is what a real one looks like: the
 * account is over its limit, so every subsequent write fails too.
 *
 * `simulateSyncQuotaError` fails only the next call, which is no longer
 * sufficient now that a write journals its intent before applying it.
 */
export function simulateSyncQuotaErrorSustained(
  message = "QUOTA_BYTES_PER_ITEM quota exceeded"
) {
  mockStorageSync.set.mockRejectedValue(new Error(message));
}

/** Restore the sync set mock after a sustained failure. */
export function clearSyncSetFailure() {
  mockStorageSync.set.mockReset();
}

/** Directly populate the sync store (bypasses mock tracking). */
export function seedSyncStore(data: Record<string, unknown>) {
  Object.assign(syncStore, data);
}

/** Directly populate the local store (bypasses mock tracking). */
export function seedLocalStore(data: Record<string, unknown>) {
  Object.assign(localStore, data);
}
