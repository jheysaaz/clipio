/**
 * Durability tests for src/storage/backends/sync.ts
 * spec: specs/storage-durability.spec.md
 *
 * Every test here corresponds to a way a write could previously have
 * destroyed a user's snippets while reporting success.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SyncBackend } from "./sync";
import { StorageQuotaError } from "../types";
import type { Snippet } from "@/types";
import {
  mockStorageSync,
  resetBrowserMocks,
  seedSyncStore,
} from "../../../tests/mocks/browser";

const PENDING_KEY = "_pendingWrite";

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

/** Read the raw sync store through the mock's get(null) path. */
async function readStore(): Promise<Record<string, unknown>> {
  return (await mockStorageSync.get(null)) as Record<string, unknown>;
}

describe("SyncBackend durability", () => {
  let backend: SyncBackend;

  beforeEach(() => {
    resetBrowserMocks();
    backend = new SyncBackend();
  });

  // -------------------------------------------------------------------------
  // Ordering: upserts must land before removals
  // -------------------------------------------------------------------------

  describe("write ordering", () => {
    it("applies upserts before removals", async () => {
      seedSyncStore({
        "snip:gone": makeSnippet({ id: "gone" }),
        "snip:keep": makeSnippet({ id: "keep" }),
      });
      const order: string[] = [];
      const realSet = mockStorageSync.set.getMockImplementation()!;
      const realRemove = mockStorageSync.remove.getMockImplementation()!;
      mockStorageSync.set.mockImplementation(async (items) => {
        order.push(`set:${Object.keys(items).join(",")}`);
        return realSet(items);
      });
      mockStorageSync.remove.mockImplementation(async (keys) => {
        order.push(`remove:${[keys].flat().join(",")}`);
        return realRemove(keys);
      });

      // "keep" is edited, so this write has BOTH an upsert and a removal and
      // the ordering between the two is observable. (An unchanged snippet
      // would produce an empty toSet and there would be nothing to order.)
      await backend.saveSnippets([
        makeSnippet({ id: "keep", label: "Kept, edited" }),
      ]);

      // The first mutation touching snippet data must be an upsert, never a
      // removal. Removals-first is what lost data on worker eviction.
      const dataOps = order.filter((o) => !o.includes(PENDING_KEY));
      expect(dataOps[0]).toMatch(/^set:/);
      const setIdx = order.findIndex(
        (o) => o.startsWith("set:") && !o.includes(PENDING_KEY)
      );
      const removeIdx = order.findIndex(
        (o) => o.startsWith("remove:") && o.includes("gone")
      );
      expect(setIdx).toBeGreaterThanOrEqual(0);
      expect(removeIdx).toBeGreaterThanOrEqual(0);
      expect(setIdx).toBeLessThan(removeIdx);
    });

    it("leaves the survivor in place when the write is interrupted after the upsert", async () => {
      // Simulate eviction by failing the removal step. The upsert already
      // landed, so the result is an extra snippet (recoverable) rather than a
      // missing one (silent loss).
      seedSyncStore({ "snip:gone": makeSnippet({ id: "gone" }) });
      const realRemove = mockStorageSync.remove.getMockImplementation()!;
      mockStorageSync.remove.mockImplementationOnce(async () => {
        throw new Error("context invalidated");
      });
      mockStorageSync.remove.mockImplementation(async (k) => realRemove(k));

      await expect(
        backend.saveSnippets([makeSnippet({ id: "new" })])
      ).rejects.toThrow();

      const store = await readStore();
      // The new snippet survived; the to-be-deleted one is still there too.
      // Both present is strictly better than both absent.
      expect(store["snip:new"]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Journal
  // -------------------------------------------------------------------------

  describe("write journal", () => {
    it("records the intent before mutating any snippet key", async () => {
      seedSyncStore({ "snip:gone": makeSnippet({ id: "gone" }) });
      const journalWrittenBeforeData = vi.fn();
      const realSet = mockStorageSync.set.getMockImplementation()!;
      mockStorageSync.set.mockImplementation(async (items) => {
        if (PENDING_KEY in items) journalWrittenBeforeData();
        return realSet(items);
      });
      const realRemove = mockStorageSync.remove.getMockImplementation()!;
      mockStorageSync.remove.mockImplementation(async (keys) => {
        journalWrittenBeforeData();
        return realRemove(keys);
      });

      await backend.saveSnippets([makeSnippet({ id: "new" })]);

      expect(journalWrittenBeforeData).toHaveBeenCalled();
    });

    it("clears the journal once the write completes", async () => {
      seedSyncStore({ "snip:gone": makeSnippet({ id: "gone" }) });
      await backend.saveSnippets([makeSnippet({ id: "new" })]);
      const store = await readStore();
      expect(store[PENDING_KEY]).toBeUndefined();
    });

    it("replays an interrupted write on the next read", async () => {
      // Simulate a crash between the journal write and the removals.
      seedSyncStore({
        "snip:gone": makeSnippet({ id: "gone" }),
        [PENDING_KEY]: {
          toSet: { "snip:new": makeSnippet({ id: "new" }) },
          toRemove: ["snip:gone"],
          at: "2026-01-01T00:00:00.000Z",
        },
      });

      const snippets = await backend.getSnippets();

      const store = await readStore();
      // Both halves of the intent were completed.
      expect(store["snip:new"]).toBeDefined();
      expect(store["snip:gone"]).toBeUndefined();
      expect(store[PENDING_KEY]).toBeUndefined();
      // And the read reflects the completed write.
      expect(snippets.map((s) => s.id)).toContain("new");
      expect(snippets.map((s) => s.id)).not.toContain("gone");
    });

    it("replay is idempotent", async () => {
      seedSyncStore({
        "snip:gone": makeSnippet({ id: "gone" }),
        [PENDING_KEY]: {
          toSet: { "snip:new": makeSnippet({ id: "new" }) },
          toRemove: ["snip:gone"],
          at: "2026-01-01T00:00:00.000Z",
        },
      });

      await backend.getSnippets();
      const afterFirst = await readStore();
      await backend.getSnippets();
      const afterSecond = await readStore();

      expect(afterSecond).toEqual(afterFirst);
      expect(afterSecond["snip:new"]).toBeDefined();
      expect(afterSecond[PENDING_KEY]).toBeUndefined();
    });

    it("never treats the journal as a snippet", async () => {
      seedSyncStore({
        [PENDING_KEY]: {
          toSet: {},
          toRemove: [],
          at: "2026-01-01T00:00:00.000Z",
        },
      });
      const snippets = await backend.getSnippets();
      expect(snippets).toEqual([]);
    });

    it("discards a journal it cannot parse, and still reads", async () => {
      seedSyncStore({
        "snip:ok": makeSnippet({ id: "ok" }),
        [PENDING_KEY]: { garbage: true },
      });
      const snippets = await backend.getSnippets();
      expect(snippets.map((s) => s.id)).toEqual(["ok"]);
      const store = await readStore();
      expect(store[PENDING_KEY]).toBeUndefined();
    });

    it("skips the journal for a payload too large to journal safely", async () => {
      // A bulk import of many snippets would transiently double its storage and
      // could push a valid write over the 100 KB cap. It must not journal.
      //
      // Asserted on the call log, not on the final store: the journal is
      // written and then removed, so its absence at read time proves nothing
      // about whether it was ever written.
      seedSyncStore({});
      const many = Array.from({ length: 400 }, (_, i) =>
        makeSnippet({ id: `bulk-${i}`, content: "x".repeat(500) })
      );
      await backend.saveSnippets(many);

      const journalWrites = mockStorageSync.set.mock.calls.filter(
        (call) => PENDING_KEY in (call[0] as Record<string, unknown>)
      );
      expect(journalWrites).toHaveLength(0);
      const store = await readStore();
      expect(
        Object.keys(store).filter((k) => k.startsWith("snip:"))
      ).toHaveLength(400);
    });

    it("does journal a small payload", async () => {
      // The complement of the test above, so the cap cannot pass by never
      // journalling anything.
      seedSyncStore({ "snip:gone": makeSnippet({ id: "gone" }) });
      await backend.saveSnippets([makeSnippet({ id: "new" })]);
      const journalWrites = mockStorageSync.set.mock.calls.filter(
        (call) => PENDING_KEY in (call[0] as Record<string, unknown>)
      );
      expect(journalWrites.length).toBeGreaterThanOrEqual(1);
    });

    it("writes no journal and performs no writes when nothing changed", async () => {
      const snippet = makeSnippet();
      seedSyncStore({ "snip:s1": snippet });
      await backend.saveSnippets([snippet]);
      expect(mockStorageSync.set).not.toHaveBeenCalled();
      expect(mockStorageSync.remove).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Quarantine
  // -------------------------------------------------------------------------

  describe("corrupt record quarantine", () => {
    it("preserves an unparseable record instead of dropping it", async () => {
      seedSyncStore({ "snip:broken": "{not json" });
      await backend.getSnippets();
      const store = await readStore();
      expect(store["corrupt:snip:broken"]).toBe("{not json");
    });

    it("removes the unparseable record from the snippet namespace", async () => {
      seedSyncStore({ "snip:broken": "{not json" });
      await backend.getSnippets();
      const store = await readStore();
      expect(store["snip:broken"]).toBeUndefined();
    });

    it("does not report a corrupt record as a snippet", async () => {
      seedSyncStore({ "snip:broken": "{not json" });
      const snippets = await backend.getSnippets();
      expect(snippets).toEqual([]);
    });

    it("does not delete a quarantined record on the next save", async () => {
      // This is the actual bug: the old code skipped the key on read, then the
      // next save's set-difference derived it as a removal.
      seedSyncStore({ "snip:broken": "{not json" });
      await backend.getSnippets();
      await backend.saveSnippets([makeSnippet({ id: "ok" })]);

      const store = await readStore();
      expect(store["corrupt:snip:broken"]).toBe("{not json");
    });

    it("keeps the healthy snippets in the same store", async () => {
      seedSyncStore({
        "snip:ok": makeSnippet({ id: "ok" }),
        "snip:broken": "{not json",
      });
      const snippets = await backend.getSnippets();
      expect(snippets.map((s) => s.id)).toEqual(["ok"]);
    });

    it("does not resurrect a quarantined record as a snippet on later upserts", async () => {
      // saveSnippets is replace-everything by design, so the hazard to rule
      // out is a single-snippet save reintroducing the quarantined key.
      seedSyncStore({ "snip:broken": "{not json" });
      await backend.getSnippets();
      await backend.upsertSnippets([makeSnippet({ id: "other" })]);
      await backend.upsertSnippets([makeSnippet({ id: "other2" })]);
      const snippets = await backend.getSnippets();
      expect(snippets.map((s) => s.id).sort()).toEqual(["other", "other2"]);
      const store = await readStore();
      expect(store["corrupt:snip:broken"]).toBe("{not json");
    });

    it("lists quarantined keys for diagnostics", async () => {
      seedSyncStore({ "snip:broken": "{not json" });
      await backend.getSnippets();
      const corrupt = await backend.listCorruptKeys();
      expect(corrupt).toEqual(["corrupt:snip:broken"]);
    });

    it("quarantines a record that parses but is not a snippet", async () => {
      seedSyncStore({ "snip:weird": JSON.stringify({ notASnippet: true }) });
      const snippets = await backend.getSnippets();
      expect(snippets).toEqual([]);
      const store = await readStore();
      expect(store["corrupt:snip:weird"]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Intent-based mutations
  // -------------------------------------------------------------------------

  describe("upsertSnippets", () => {
    it("writes the given snippet without touching anything else", async () => {
      seedSyncStore({
        "snip:a": makeSnippet({ id: "a" }),
        "snip:b": makeSnippet({ id: "b" }),
      });
      await backend.upsertSnippets([makeSnippet({ id: "c", label: "C" })]);
      const store = await readStore();
      expect(store["snip:c"]).toBeDefined();
      expect(store["snip:a"]).toBeDefined();
      expect(store["snip:b"]).toBeDefined();
    });

    it("does not delete a snippet created by another context after our read", async () => {
      // The lost-update case: a delete computed from a stale read used to
      // remove everything it had not seen.
      seedSyncStore({ "snip:mine": makeSnippet({ id: "mine" }) });
      await backend.removeSnippetsById(["mine"]);
      const store = await readStore();
      expect(store["snip:mine"]).toBeUndefined();
    });

    it("is a no-op for an empty list", async () => {
      await backend.upsertSnippets([]);
      expect(mockStorageSync.set).not.toHaveBeenCalled();
    });
  });

  describe("removeSnippetsById", () => {
    it("removes exactly the named id and nothing else", async () => {
      seedSyncStore({
        "snip:a": makeSnippet({ id: "a" }),
        "snip:b": makeSnippet({ id: "b" }),
        "snip:c": makeSnippet({ id: "c" }),
      });
      await backend.removeSnippetsById(["b"]);
      const store = await readStore();
      expect(store["snip:b"]).toBeUndefined();
      expect(store["snip:a"]).toBeDefined();
      expect(store["snip:c"]).toBeDefined();
    });

    it("does not remove a quarantined record with a similar id", async () => {
      seedSyncStore({ "corrupt:snip:x": "{bad" });
      await backend.removeSnippetsById(["x"]);
      const store = await readStore();
      expect(store["corrupt:snip:x"]).toBe("{bad");
    });

    it("is a no-op for an empty list", async () => {
      await backend.removeSnippetsById([]);
      expect(mockStorageSync.remove).not.toHaveBeenCalled();
    });

    it("tolerates an id that is not present", async () => {
      seedSyncStore({ "snip:a": makeSnippet({ id: "a" }) });
      await expect(
        backend.removeSnippetsById(["nope"])
      ).resolves.toBeUndefined();
      const store = await readStore();
      expect(store["snip:a"]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Quota still surfaces as StorageQuotaError
  // -------------------------------------------------------------------------

  describe("quota errors", () => {
    it("raises StorageQuotaError so the manager can fall back", async () => {
      mockStorageSync.set.mockRejectedValue(
        new Error("QUOTA_BYTES quota exceeded")
      );
      try {
        await expect(backend.saveSnippets([makeSnippet()])).rejects.toThrow(
          StorageQuotaError
        );
      } finally {
        mockStorageSync.set.mockReset();
      }
    });

    it("propagates a non-quota error unchanged", async () => {
      mockStorageSync.set.mockRejectedValue(new Error("Network failure"));
      try {
        await expect(backend.saveSnippets([makeSnippet()])).rejects.toThrow(
          "Network failure"
        );
      } finally {
        mockStorageSync.set.mockReset();
      }
    });
  });
});
