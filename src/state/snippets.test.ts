import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  loadSnippets,
  checkForRecovery,
  initialiseSnippets,
  addSnippet,
  editSnippet,
  removeSnippet,
  restoreRecoveredSnippets,
  dismissRecoveryBanner,
  dismissQuotaWarning,
  dismissSyncPausedWarning,
  dismissLoadError,
  dismissRecoveryError,
  findSnippet,
  resetSnippetsStoreForTests,
  snippetsStore,
  type SnippetsState,
} from "./snippets";

import type { Snippet } from "@/types";

/**
 * The storage layer is mocked wholesale rather than driven through the in-memory
 * browser mock. These tests are about the store's decisions — when a write is a
 * refusal, what the library looks like afterwards, which load wins a race — and
 * routing them through a real `StorageManager` would make them tests of the
 * backend wearing the store's name.
 *
 * The one thing that *is* exercised for real is `browser.storage.onChanged`,
 * because that subscription is the feature: it is what makes an open popup see a
 * change made in the options page. A mocked event that never fires would make it
 * untestable, which is exactly the gap this file exists to close.
 */

const storage = vi.hoisted(() => ({
  getSnippets: vi.fn(),
  saveSnippet: vi.fn(),
  updateSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
  getStorageStatus: vi.fn(),
  bulkSaveSnippets: vi.fn(),
  tryRecoverFromBackup: vi.fn(),
  clearSyncDataLostFlag: vi.fn(),
  StorageQuotaError: class StorageQuotaError extends Error {
    reasons?: { kind: string; actual: number; limit: number }[];
    constructor(reasons?: { kind: string; actual: number; limit: number }[]) {
      super("quota");
      this.name = "StorageQuotaError";
      this.reasons = reasons;
    }
  },
}));

vi.mock("@/storage", () => storage);

vi.mock("@/storage/items", () => ({
  syncDataLostItem: { getValue: vi.fn(async () => false) },
}));

vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

import { syncDataLostItem } from "@/storage/items";
import {
  emitStorageChange,
  resetBrowserMocks,
} from "../../tests/mocks/browser";

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "First",
    shortcut: "/a",
    content: "content",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Snippet;
}

const OK_STATUS = {
  quotaExceeded: false,
  mode: "sync",
  localReason: null,
};

/** The state the store is in now, read fresh. */
function state(): SnippetsState {
  return snippetsStore.state;
}

beforeEach(() => {
  resetBrowserMocks();
  resetSnippetsStoreForTests();
  storage.getSnippets.mockResolvedValue([]);
  storage.getStorageStatus.mockResolvedValue(OK_STATUS);
  storage.saveSnippet.mockResolvedValue(undefined);
  storage.updateSnippet.mockResolvedValue(undefined);
  storage.deleteSnippet.mockResolvedValue(undefined);
  storage.bulkSaveSnippets.mockResolvedValue(undefined);
  storage.tryRecoverFromBackup.mockResolvedValue([]);
  storage.clearSyncDataLostFlag.mockResolvedValue(undefined);
  vi.mocked(syncDataLostItem.getValue).mockResolvedValue(false as never);
});

// ---------------------------------------------------------------------------

describe("loadSnippets", () => {
  it("fills the library and marks it loaded", async () => {
    storage.getSnippets.mockResolvedValue([makeSnippet()]);

    await loadSnippets();

    expect(state().snippets).toHaveLength(1);
    expect(state().isLoaded).toBe(true);
    expect(state().loadError).toBeNull();
  });

  it("reports the read error and still marks loaded", async () => {
    // The negative case, and the one that mattered: leaving `isLoaded` false here
    // kept the dashboard spinning forever on an error it could not display.
    storage.getSnippets.mockRejectedValue(new Error("storage unavailable"));

    await loadSnippets();

    expect(state().loadError).not.toBeNull();
    expect(state().isLoaded).toBe(true);
  });

  it("marks loaded even when only the status read fails", async () => {
    // The list is the thing the user is waiting for. Losing the *warning* is not a
    // reason to leave a spinner up over a library that has arrived.
    storage.getSnippets.mockResolvedValue([makeSnippet()]);
    storage.getStorageStatus.mockRejectedValue(new Error("status unavailable"));

    await loadSnippets();

    expect(state().snippets).toHaveLength(1);
    expect(state().isLoaded).toBe(true);
  });

  it("raises the quota warning when storage reports over-quota", async () => {
    storage.getStorageStatus.mockResolvedValue({
      ...OK_STATUS,
      quotaExceeded: true,
    });

    await loadSnippets();

    expect(state().quotaWarning).toBe(true);
    // Quota is the more urgent of the two, so it wins. Showing both would tell
    // the user their edits are not syncing *and* that there is no room, which is
    // one problem described twice.
    expect(state().syncPausedWarning).toBe(false);
  });

  it("raises the sync-paused warning when the user chose local mode", async () => {
    storage.getStorageStatus.mockResolvedValue({
      ...OK_STATUS,
      mode: "local",
      localReason: "manual",
    });

    await loadSnippets();

    expect(state().syncPausedWarning).toBe(true);
  });

  it("does not raise sync-paused for an automatic local fallback", async () => {
    // "manual" means the user chose it and should be told their edits stay here.
    // An automatic fallback is a different message, and this store does not have
    // one — so it must stay silent rather than misattribute the cause.
    storage.getStorageStatus.mockResolvedValue({
      ...OK_STATUS,
      mode: "local",
      localReason: "quota",
    });

    await loadSnippets();

    expect(state().syncPausedWarning).toBe(false);
  });

  it("does not let a stale read overwrite a newer one", async () => {
    // The race the generation counter exists for. Both reads are issued before
    // either resolves, and the *older* one resolves last — so without the guard
    // the user's freshly added snippet is silently reverted.
    const slow = makeSnippet({ id: "old" });
    const fresh = makeSnippet({ id: "new" });

    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    storage.getSnippets
      .mockReturnValueOnce(slowGate.then(() => [slow]) as never)
      .mockResolvedValueOnce([fresh]);

    const first = loadSnippets();
    await loadSnippets(); // the newer read wins
    releaseSlow();
    await first;

    expect(state().snippets.map((s) => s.id)).toEqual(["new"]);
  });
});

// ---------------------------------------------------------------------------

describe("checkForRecovery", () => {
  it("shows the banner when a backup was recovered", async () => {
    vi.mocked(syncDataLostItem.getValue).mockResolvedValue(true as never);
    storage.tryRecoverFromBackup.mockResolvedValue([
      makeSnippet({ id: "recovered" }),
    ]);

    await checkForRecovery();

    expect(state().recoverySnippets).toHaveLength(1);
    expect(state().showRecoveryBanner).toBe(true);
  });

  it("shows nothing when the data-loss flag is not set", async () => {
    // The negative case with teeth: an unconditional banner would put a scary
    // "your data was lost" message in front of every user on every open.
    await checkForRecovery();

    expect(state().showRecoveryBanner).toBe(false);
    expect(storage.tryRecoverFromBackup).not.toHaveBeenCalled();
  });

  it("clears the flag even when the backup was empty", async () => {
    vi.mocked(syncDataLostItem.getValue).mockResolvedValue(true as never);
    storage.tryRecoverFromBackup.mockResolvedValue([]);

    await checkForRecovery();

    expect(storage.clearSyncDataLostFlag).toHaveBeenCalled();
    expect(state().showRecoveryBanner).toBe(false);
  });

  it("survives a failing recovery scan", async () => {
    vi.mocked(syncDataLostItem.getValue).mockResolvedValue(true as never);
    storage.tryRecoverFromBackup.mockRejectedValue(new Error("backup corrupt"));

    await expect(checkForRecovery()).resolves.toBeUndefined();

    expect(state().showRecoveryBanner).toBe(false);
  });
});

describe("initialiseSnippets", () => {
  it("loads the library even when the recovery check fails", async () => {
    // They are independent. Sequencing them meant a throwing flag check left the
    // user staring at a spinner over an empty library.
    vi.mocked(syncDataLostItem.getValue).mockRejectedValue(new Error("flag"));
    storage.getSnippets.mockResolvedValue([makeSnippet()]);

    await initialiseSnippets();

    expect(state().snippets).toHaveLength(1);
    expect(state().isLoaded).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("addSnippet", () => {
  it("adds the created snippet to the library", async () => {
    const result = await addSnippet({
      label: "New",
      shortcut: "/n",
      content: "body",
      tags: [],
    });

    expect(result.ok).toBe(true);
    expect(state().snippets).toHaveLength(1);
    expect(storage.saveSnippet).toHaveBeenCalledOnce();
  });

  it("does not touch the library when the write is refused", async () => {
    storage.saveSnippet.mockRejectedValue(new Error("disk full"));

    const result = await addSnippet({
      label: "New",
      shortcut: "/n",
      content: "body",
      tags: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toBeTruthy();
    expect(state().snippets).toHaveLength(0);
  });

  it("raises the banner and names the limit on a quota refusal", async () => {
    storage.saveSnippet.mockRejectedValue(
      new storage.StorageQuotaError([
        { kind: "per-item", actual: 10_000, limit: 8_192 },
      ])
    );

    const result = await addSnippet({
      label: "New",
      shortcut: "/n",
      content: "body",
      tags: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // The limit is named rather than saying "quota exceeded", so the user can act.
    expect(result.error).toContain("8.0 KB");
    expect(state().quotaWarning).toBe(true);
  });

  it('names the limit rather than saying only "quota exceeded"', async () => {
    storage.saveSnippet.mockRejectedValue(
      new storage.StorageQuotaError([
        { kind: "per-item", actual: 2048, limit: 1024 },
      ])
    );

    const result = await addSnippet({
      label: "N",
      shortcut: "/n",
      content: "b",
      tags: [],
    });

    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("2.0 KB");
    expect(result.error).toContain("1.0 KB");
  });

  it("falls back to generic copy when the quota error carries no reasons", async () => {
    storage.saveSnippet.mockRejectedValue(new storage.StorageQuotaError());

    const result = await addSnippet({
      label: "N",
      shortcut: "/n",
      content: "b",
      tags: [],
    });

    if (result.ok) throw new Error("expected a refusal");
    // The real copy from `en.yml`, not a guess. The stub `#i18n` resolves against
    // that file, so asserting against anything else would pass for the wrong reason.
    expect(result.error).toBe(
      "Sync storage is full, so this snippet was not saved."
    );
  });
});

// ---------------------------------------------------------------------------

describe("editSnippet", () => {
  it("replaces the snippet in place", async () => {
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: [makeSnippet(), makeSnippet({ id: "s2" })],
    }));

    await editSnippet(makeSnippet({ label: "Renamed" }));

    const list = state().snippets;
    expect(list[0].label).toBe("Renamed");
    // In place, not appended: a match by id, so order is preserved.
    expect(list).toHaveLength(2);
  });

  it("leaves the library untouched when the update fails", async () => {
    snippetsStore.setState((prev) => ({ ...prev, snippets: [makeSnippet()] }));
    storage.updateSnippet.mockRejectedValue(new Error("network down"));

    const result = await editSnippet(makeSnippet({ label: "Renamed" }));

    expect(result.ok).toBe(false);
    expect(state().snippets[0].label).toBe("First");
  });

  it("raises the banner on a quota refusal", async () => {
    storage.updateSnippet.mockRejectedValue(
      new storage.StorageQuotaError([
        { kind: "count", actual: 600, limit: 500 },
      ])
    );

    const result = await editSnippet(makeSnippet());

    expect(result.ok).toBe(false);
    expect(state().quotaWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("removeSnippet", () => {
  it("removes it and returns what is left", async () => {
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: [makeSnippet(), makeSnippet({ id: "s2" })],
    }));

    const { remaining } = await removeSnippet("s1");

    expect(remaining.map((s) => s.id)).toEqual(["s2"]);
    expect(state().snippets).toHaveLength(1);
  });

  it("rethrows so the caller cannot report a failure as a success", async () => {
    snippetsStore.setState((prev) => ({ ...prev, snippets: [makeSnippet()] }));
    storage.deleteSnippet.mockRejectedValue(new Error("locked"));

    await expect(removeSnippet("s1")).rejects.toThrow("locked");
    // The library is untouched: a failed delete must not look like a delete.
    expect(state().snippets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("restoreRecoveredSnippets", () => {
  beforeEach(() => {
    snippetsStore.setState((prev) => ({
      ...prev,
      recoverySnippets: [makeSnippet({ id: "r1" })],
      showRecoveryBanner: true,
    }));
  });

  it("returns the refreshed library, not the pre-restore one", async () => {
    storage.getSnippets.mockResolvedValue([makeSnippet({ id: "r1" })]);

    const result = await restoreRecoveredSnippets();

    expect(result.ok).toBe(true);
    // The caller navigates using this. Reading the store from its own
    // render-time value would pick from the library as it was *before* the
    // restore — which is what this return value exists to prevent.
    if (!result.ok) throw new Error("expected success");
    expect(result.value.map((s) => s.id)).toEqual(["r1"]);
    expect(state().showRecoveryBanner).toBe(false);
  });

  it("keeps the banner up and records the error when the restore fails", async () => {
    storage.bulkSaveSnippets.mockRejectedValue(new Error("quota again"));

    const result = await restoreRecoveredSnippets();

    expect(result.ok).toBe(false);
    // The banner stays: the recovery has not happened, and hiding it would leave
    // the user with no way back to the snippets they were just offered.
    expect(state().showRecoveryBanner).toBe(true);
    expect(state().recoveryError).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("live cross-context sync", () => {
  it("re-reads when a snippet key changes elsewhere", async () => {
    // The feature. An open popup used to keep showing a stale library: nothing
    // listened for changes, so a snippet deleted in the options page stayed in
    // the list with a delete button that would fail.
    await loadSnippets();
    storage.getSnippets.mockResolvedValue([makeSnippet({ id: "elsewhere" })]);

    emitStorageChange(
      { "snip:elsewhere": { oldValue: undefined, newValue: {} } },
      "sync"
    );
    await vi.waitFor(() =>
      expect(state().snippets.map((s) => s.id)).toEqual(["elsewhere"])
    );
  });

  it("ignores a change to a key that is not a snippet", async () => {
    await loadSnippets();
    storage.getSnippets.mockClear();
    storage.getSnippets.mockResolvedValue([makeSnippet({ id: "nope" })]);

    emitStorageChange({ uiFont: { newValue: "inter" } }, "sync");
    await Promise.resolve();

    // No re-read at all: the manager's `getSnippets` migrates and normalises on
    // the way, so a spurious call on every unrelated storage write is not free.
    expect(storage.getSnippets).not.toHaveBeenCalled();
    expect(state().snippets).toHaveLength(0);
  });

  it("keeps the current library when the refresh fails", async () => {
    snippetsStore.setState((prev) => ({ ...prev, snippets: [makeSnippet()] }));
    storage.getSnippets.mockRejectedValue(new Error("context invalidated"));

    emitStorageChange({ "snip:x": { newValue: {} } }, "sync");
    await vi.waitFor(() => expect(storage.getSnippets).toHaveBeenCalled());

    // A failed refresh must not blank the list the user is reading.
    expect(state().snippets).toHaveLength(1);
  });

  it("survives a listener that throws", async () => {
    // Real storage does not let a subscriber's throw break the writer. If it did,
    // one bad listener would be indistinguishable from a storage failure.
    const onChanged = browser.storage.onChanged as unknown as {
      addListener: (fn: () => void) => void;
    };
    onChanged.addListener(() => {
      throw new Error("a badly-behaved subscriber");
    });
    storage.getSnippets.mockResolvedValue([makeSnippet({ id: "after-throw" })]);

    emitStorageChange({ "snip:x": { newValue: {} } }, "sync");

    // The store's own subscriber still ran. Real storage does not let one
    // subscriber's throw break the others, and if it did, a single bad listener
    // would be indistinguishable from storage being broken.
    await vi.waitFor(() =>
      expect(state().snippets.map((s) => s.id)).toEqual(["after-throw"])
    );
  });
});

// ---------------------------------------------------------------------------

describe("findSnippet", () => {
  const list = [makeSnippet({ id: "a" }), makeSnippet({ id: "b" })];

  it("finds the addressed snippet", () => {
    expect(findSnippet(list, "b")?.id).toBe("b");
  });

  it("returns null for no id", () => {
    expect(findSnippet(list, null)).toBeNull();
  });

  it("returns null for an id that is not there", () => {
    // The deep-link case: a URL can address a snippet that was deleted in
    // another context.
    expect(findSnippet(list, "gone")).toBeNull();
  });

  it("returns null for an empty library", () => {
    expect(findSnippet([], "a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("dismissals", () => {
  it("clears each warning independently", () => {
    snippetsStore.setState((prev) => ({
      ...prev,
      quotaWarning: true,
      syncPausedWarning: true,
      loadError: "boom",
      recoveryError: "bang",
      showRecoveryBanner: true,
    }));

    dismissQuotaWarning();
    expect(state().quotaWarning).toBe(false);
    expect(state().syncPausedWarning).toBe(true);

    dismissSyncPausedWarning();
    expect(state().syncPausedWarning).toBe(false);

    dismissLoadError();
    expect(state().loadError).toBeNull();
    expect(state().recoveryError).toBe("bang");

    dismissRecoveryError();
    dismissRecoveryBanner();
    expect(state().recoveryError).toBeNull();
    expect(state().showRecoveryBanner).toBe(false);
  });
});
