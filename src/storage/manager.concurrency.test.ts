/**
 * Cross-context concurrency tests for StorageManager.
 * spec: specs/storage-durability.spec.md
 *
 * The popup and the options page are separate JavaScript contexts, each with
 * its own StorageManager, mutating one shared browser.storage.sync. These
 * tests drive two managers against one store, which manager.test.ts — which
 * only ever used a single context — structurally could not do.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StorageManager } from "./manager";
import { StorageQuotaError } from "./types";
import type { Snippet } from "@/types";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "s1",
  label: "One",
  shortcut: "/one",
  content: "one",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

/**
 * A shared store that both managers mutate, with a hook that lets a test
 * interleave another context's write between our read and our write.
 */
function createSharedStore(initial: Snippet[] = []) {
  const store = new Map<string, Snippet>(initial.map((s) => [s.id, s]));
  const onBeforeWrite: Array<() => void> = [];

  return {
    store,
    onBeforeWrite,
    /** Simulate another context writing just before our write lands. */
    interleave(fn: () => void) {
      onBeforeWrite.push(fn);
    },
    getSnippets: vi.fn(async () => [...store.values()]),
    upsertSnippets: vi.fn(async (snippets: Snippet[]) => {
      onBeforeWrite.forEach((fn) => fn());
      for (const s of snippets) store.set(s.id, s);
    }),
    removeSnippetsById: vi.fn(async (ids: string[]) => {
      onBeforeWrite.forEach((fn) => fn());
      for (const id of ids) store.delete(id);
    }),
    saveSnippets: vi.fn(async (snippets: Snippet[]) => {
      onBeforeWrite.forEach((fn) => fn());
      store.clear();
      for (const s of snippets) store.set(s.id, s);
    }),
    clear: vi.fn(async () => store.clear()),
  };
}

const hoisted = vi.hoisted(() => ({
  mockStorageMode: {
    getValue: vi.fn(),
    setValue: vi.fn(),
  },
  mockStorageModeReason: {
    getValue: vi.fn(),
    setValue: vi.fn(),
  },
  mockSyncDataLost: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    removeValue: vi.fn(),
  },
  mockUpdateCache: vi.fn(),
  mockDebugLog: vi.fn(),
}));

vi.mock("~/storage/items", () => ({
  storageModeItem: hoisted.mockStorageMode,
  storageModeReasonItem: hoisted.mockStorageModeReason,
  syncDataLostItem: hoisted.mockSyncDataLost,
  localSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  cachedSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  debugLogItem: { getValue: vi.fn(), setValue: vi.fn() },
}));

vi.mock("~/storage/backends/local", () => ({
  // A LocalBackend that records intent-based mutations, so the quota-fallback
  // path can be exercised end to end.
  LocalBackend: class {
    async getSnippets() {
      return [];
    }
    async saveSnippets() {}
    async upsertSnippets() {}
    async removeSnippetsById() {}
    async clear() {}
  },
  updateContentScriptCache: hoisted.mockUpdateCache,
}));

vi.mock("~/storage/backends/media", () => ({
  getMedia: vi.fn(),
  listMedia: vi.fn(async () => []),
}));

vi.mock("~/lib/debug", () => ({ debugLog: hoisted.mockDebugLog }));
vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

/**
 * Build a manager whose sync backend is the supplied shared store.
 *
 * Uses the real StorageManager so the actual mutation code under test runs;
 * only the browser API is doubled.
 */
function makeManagerWith(shared: ReturnType<typeof createSharedStore>) {
  const m = new StorageManager();
  (m as unknown as { sync: unknown }).sync = shared;
  (m as unknown as { idb: unknown }).idb = {
    saveSnippets: vi.fn(async () => {}),
  };
  return m;
}

describe("StorageManager cross-context concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockStorageMode.getValue.mockResolvedValue("sync");
    hoisted.mockStorageModeReason.getValue.mockResolvedValue("quota");
    hoisted.mockStorageModeReason.setValue.mockResolvedValue(undefined);
    hoisted.mockUpdateCache.mockResolvedValue(undefined);
    hoisted.mockDebugLog.mockResolvedValue(undefined);
  });

  it("a delete does not remove a snippet another context created in between", async () => {
    // The exact cross-context data loss that read-modify-write caused:
    //   popup reads [A, B]
    //   options creates C
    //   popup deletes A, writes back its stale [B]
    //   => C is gone
    const shared = createSharedStore([
      makeSnippet({ id: "A" }),
      makeSnippet({ id: "B" }),
    ]);
    const popup = makeManagerWith(shared);

    // Simulate the options page creating C after the popup's read.
    shared.interleave(() => shared.store.set("C", makeSnippet({ id: "C" })));

    await popup.deleteSnippet("A");

    expect(shared.store.has("A")).toBe(false); // intended deletion
    expect(shared.store.has("B")).toBe(true); // untouched
    expect(shared.store.has("C")).toBe(true); // survived
  });

  it("a save does not revert a snippet another context updated in between", async () => {
    const shared = createSharedStore([
      makeSnippet({ id: "A", label: "original" }),
    ]);
    const popup = makeManagerWith(shared);

    // The options page edits A after the popup's read.
    shared.interleave(() =>
      shared.store.set("A", makeSnippet({ id: "A", label: "edited elsewhere" }))
    );

    await popup.saveSnippet(makeSnippet({ id: "B" }));

    // The popup only wrote B; A still holds the other context's edit.
    expect(shared.store.get("A")?.label).toBe("edited elsewhere");
    expect(shared.store.get("B")?.label).toBe("One");
  });

  it("two contexts can each add a snippet without losing either", async () => {
    const shared = createSharedStore([]);
    const popup = makeManagerWith(shared);
    const options = makeManagerWith(shared);

    await Promise.all([
      popup.saveSnippet(makeSnippet({ id: "from-popup" })),
      options.saveSnippet(makeSnippet({ id: "from-options" })),
    ]);

    expect(shared.store.has("from-popup")).toBe(true);
    expect(shared.store.has("from-options")).toBe(true);
  });

  it("an update touches only the named snippet", async () => {
    const shared = createSharedStore([
      makeSnippet({ id: "A" }),
      makeSnippet({ id: "B" }),
    ]);
    const m = makeManagerWith(shared);

    await m.updateSnippet(makeSnippet({ id: "A", label: "changed" }));

    expect(shared.store.get("A")?.label).toBe("changed");
    expect(shared.store.get("B")?.label).toBe("One");
  });

  it("refreshes the content-script cache from the authoritative store", async () => {
    // A stale derived store is how a user types a shortcut and gets yesterday's
    // snippet, so the cache must be re-read rather than echoing the caller's
    // possibly-stale list.
    const shared = createSharedStore([makeSnippet({ id: "A" })]);
    const m = makeManagerWith(shared);

    shared.interleave(() => shared.store.set("B", makeSnippet({ id: "B" })));
    await m.saveSnippet(makeSnippet({ id: "C" }));

    const cached = hoisted.mockUpdateCache.mock.calls.at(-1)?.[0] as Snippet[];
    expect(cached.map((s) => s.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("still replaces the whole set for bulkSaveSnippets (import semantics)", async () => {
    // bulkSaveSnippets is the one path that genuinely means "these are all my
    // snippets" — the ImportWizard has already resolved conflicts with the
    // user. It must keep the replace-everything behaviour.
    const shared = createSharedStore([makeSnippet({ id: "stale" })]);
    const m = makeManagerWith(shared);

    await m.bulkSaveSnippets([makeSnippet({ id: "fresh" })]);

    expect([...shared.store.keys()]).toEqual(["fresh"]);
  });

  it("does not switch storage mode on a quota error from an upsert", async () => {
    // A quota-failed write is refused, not redirected. Flipping the install to
    // local mode here — silently and permanently — is what Wave 9 removed.
    // spec: specs/storage-quota-preflight.spec.md
    const shared = createSharedStore([]);
    shared.upsertSnippets = vi.fn(async () => {
      throw new StorageQuotaError();
    });
    const m = makeManagerWith(shared);

    await expect(m.saveSnippet(makeSnippet({ id: "A" }))).rejects.toThrow(
      StorageQuotaError
    );
    expect(hoisted.mockStorageMode.setValue).not.toHaveBeenCalledWith("local");
  });
});
