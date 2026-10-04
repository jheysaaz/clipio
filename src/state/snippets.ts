/**
 * The snippet library, as a store.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `Dashboard.tsx` held this state as ~25 `useState` calls and reached for
 * `@/storage` in five separate effects. Three things followed from that, and all
 * three were real:
 *
 *  - **No single owner.** `snippets`, `loading`, and the two storage warnings
 *    were set from whichever effect happened to be running, so the dashboard had
 *    four independent paths that could each assert "the library is ready".
 *  - **No live sync.** Snippets live in `browser.storage` under `snip:<id>`, and
 *    nothing listened for changes. The popup shows a stale library for as long as
 *    it stays open — which for a popup means until the next blur, so a snippet
 *    deleted in the options page stayed in the list and its delete button
 *    re-appeared to fail.
 *  - **The list was written by hand after every mutation.** `saveSnippet` then
 *    `setSnippets(prev => [...prev, next])` in three places, each getting the
 *    ordering subtly wrong.
 *
 * The store owns the list and the writes, so "the library changed" is one event
 * whether it came from this context, the options page, or the background worker.
 *
 * ── What deliberately stays out ──────────────────────────────────────────────
 *
 * The selected snippet is **not** here. The route holds the id — that is the
 * point of the router work (ADR 0011) — and the object is looked up from `snippets`
 * by `findSnippet`. Storing both would put the same fact in two places, which is
 * how the detail pane ended up rendering a pre-edit copy of the snippet you were
 * editing.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import type { Snippet, SnippetFormData } from "@/types";
import { createSnippet } from "@/types";
import {
  bulkSaveSnippets,
  deleteSnippet as deleteSnippetFromStorage,
  getSnippets as getSnippetsFromStorage,
  getStorageStatus,
  saveSnippet as saveSnippetToStorage,
  StorageQuotaError,
  tryRecoverFromBackup,
  updateSnippet as updateSnippetInStorage,
  clearSyncDataLostFlag,
} from "@/storage";
import { syncDataLostItem } from "@/storage/items";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";

export type SnippetsState = {
  /**
   * The library.
   *
   * Empty until the first load resolves. `isLoaded` is what says whether empty
   * means "no snippets" or "not yet read" — the dashboard needs that
   * distinction to decide between a spinner and an empty state.
   */
  snippets: Snippet[];
  /** Whether the first read has settled, successfully or not. */
  isLoaded: boolean;
  /** Set when the read failed. `null` when there is nothing to report. */
  loadError: string | null;
  /**
   * Storage is over quota, so writes are being refused.
   *
   * Set from the status read *and* from a refused write. It is a warning about
   * the backend, not about one operation, so it stays up once shown — a user who
   * dismisses it and then creates a snippet gets it again, which is the point.
   */
  quotaWarning: boolean;
  /**
   * Sync is paused and the library is local-only.
   *
   * Distinct from `quotaWarning`: nothing is wrong, but edits will not reach
   * other devices, and the user should know that before they make one.
   */
  syncPausedWarning: boolean;
  /** Snippets recovered from the sign-out backup, awaiting the user's decision. */
  recoverySnippets: Snippet[];
  /** Whether the recovery banner is showing. */
  showRecoveryBanner: boolean;
  /** Set when restoring the recovery backup failed. */
  recoveryError: string | null;
};

export const snippetsStore = createStore<SnippetsState>({
  snippets: [],
  isLoaded: false,
  loadError: null,
  quotaWarning: false,
  syncPausedWarning: false,
  recoverySnippets: [],
  showRecoveryBanner: false,
  recoveryError: null,
});

// ---------------------------------------------------------------------------
// Internal error copy
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Guards against an out-of-order read landing last.
 *
 * `loadSnippets` is called on mount and again from the storage-change listener,
 * and the two can overlap — a snippet saved in another context fires the
 * listener while the initial read is still in flight. Without this, the initial
 * read's response (issued first, containing the older list) could resolve second
 * and overwrite the newer one, silently reverting the user's snippet.
 */
let loadGeneration = 0;

export async function loadSnippets(): Promise<void> {
  const generation = ++loadGeneration;
  const isStale = () => generation !== loadGeneration;

  // Marked loading only for the *first* read. A background refresh must not flip
  // `isLoaded` back to false, which would blank the list the user is reading.
  if (!snippetsStore.state.isLoaded) {
    snippetsStore.setState((prev) => ({ ...prev, isLoaded: false }));
  }

  try {
    const list = await getSnippetsFromStorage();
    if (isStale()) return;
    snippetsStore.setState((prev) => ({ ...prev, snippets: list }));

    const status = await getStorageStatus();
    if (isStale()) return;
    snippetsStore.setState((prev) => ({
      ...prev,
      isLoaded: true,
      quotaWarning: status.quotaExceeded,
      syncPausedWarning:
        !status.quotaExceeded &&
        status.mode === "local" &&
        status.localReason === "manual",
    }));
  } catch (error) {
    if (isStale()) return;
    console.error("[Clipio] Failed to load snippets:", error);
    captureError(error, { action: "loadSnippets" });
    // `isLoaded` is set even on failure. Leaving it false would keep the
    // dashboard spinning forever on an error it cannot show.
    snippetsStore.setState((prev) => ({
      ...prev,
      isLoaded: true,
      loadError: i18n.t("dashboard.errors.failedToLoad"),
    }));
  }
}

/**
 * Offer the sign-out backup for recovery, if there is one.
 *
 * Separate from `loadSnippets` because it answers a different question and is
 * gated on a flag: showing a recovery banner unconditionally would put a scary
 * "your data was lost" message in front of everyone on every open.
 */
export async function checkForRecovery(): Promise<void> {
  try {
    const dataLost = await syncDataLostItem.getValue();
    if (!dataLost) return;

    const backup = await tryRecoverFromBackup();
    if (backup.length > 0) {
      snippetsStore.setState((prev) => ({
        ...prev,
        recoverySnippets: backup,
        showRecoveryBanner: true,
      }));
    }
    // Cleared whether or not anything was recovered: the flag means "we lost
    // sync", and re-checking it on every future open would re-run the scan
    // forever.
    await clearSyncDataLostFlag();
  } catch (error) {
    console.error("[Clipio] Flag check failed:", error);
    captureError(error, { action: "flagCheck" });
  }
}

/**
 * Load the library and check for a recoverable backup.
 *
 * Both are independent — one failing must not stop the other — so this is two
 * calls, not a sequence. Neither throws: they capture and set state themselves.
 */
export async function initialiseSnippets(): Promise<void> {
  await Promise.all([loadSnippets(), checkForRecovery()]);
}

// ---------------------------------------------------------------------------
// Live cross-context sync
// ---------------------------------------------------------------------------

/** The key prefix every snippet is stored under, in whichever area is active. */
const SNIPPET_KEY_PREFIX = "snip:";

/**
 * Merge a re-read list into the store without disturbing local UI state.
 *
 * The re-read *is* the truth — it is the same call the manager would make — so it
 * replaces the list wholesale rather than being merged. What it must not touch
 * is anything the user is currently looking at: a dismissed recovery banner, an
 * error they have not acted on yet.
 */
function applyRefreshedList(list: Snippet[]): void {
  snippetsStore.setState((prev) => ({
    ...prev,
    snippets: list,
    isLoaded: true,
  }));
}

/**
 * Re-read when a snippet key changes in any storage area.
 *
 * Not torn down. The store lives as long as the document does, and the document
 * going away is what ends it — the same reasoning as the `uiFontItem.watch` in
 * `settings.ts`. An unused `_dispose` export existed there for a moment and was a
 * promise nobody kept.
 *
 * Every area is watched, not just the active one, because the manager's mode can
 * change while the popup is open. Re-reading through the manager always reads the
 * right area, so a change in the *inactive* one is simply a no-op read.
 */
if (typeof browser !== "undefined" && browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    const touched = Object.keys(changes).some((key) =>
      key.startsWith(SNIPPET_KEY_PREFIX)
    );
    if (!touched) return;

    getSnippetsFromStorage()
      .then(applyRefreshedList)
      .catch((error: unknown) => {
        // A failed refresh must not clear the list the user is reading. Report
        // it and leave the previous contents in place.
        captureError(error, { action: "snippets.refresh", areaName });
      });
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** The outcome of a write, so callers can react to a refusal. */
export type WriteOutcome<T = void> =
  { ok: true; value: T } | { ok: false; error: string };

/** Bytes as KB, for the quota message. The limits are small enough that one
 *  decimal is enough to be useful and never enough to be misleading. */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Turn a `StorageQuotaError` into something the user can act on.
 *
 * `checkQuota` says which limit broke and by how much, so the message can name
 * it instead of saying "quota exceeded". Falls back to the generic copy when the
 * error came from the browser rather than the preflight, which is the one case
 * where we have no breakdown — and the case we want to hear about, so it is also
 * reported.
 *
 * Moved here from `Dashboard.tsx` because the quota decision belongs with the
 * write that failed. Left in the page, it was a helper only reachable from the
 * one component that happened to hold the error.
 */
function quotaMessage(error: StorageQuotaError): string {
  const reasons = error.reasons;
  if (!reasons || reasons.length === 0) {
    captureError(error, { action: "quotaError.noReasons" });
    return i18n.t("dashboard.errors.quotaExceeded");
  }

  const substitute = (template: string, actual: string, limit: string) =>
    template.replace("{actual}", actual).replace("{limit}", limit);

  const parts = reasons.map((reason) => {
    if (reason.kind === "per-item") {
      const template = i18n.t("dashboard.errors.quotaPerItem", [
        "{actual}",
        "{limit}",
      ]);
      return substitute(
        template,
        formatBytes(reason.actual),
        formatBytes(reason.limit)
      );
    }
    if (reason.kind === "count") {
      const template = i18n.t("dashboard.errors.quotaCount", [
        "{actual}",
        "{limit}",
      ]);
      return substitute(template, String(reason.actual), String(reason.limit));
    }
    const template = i18n.t("dashboard.errors.quotaTotal", [
      "{actual}",
      "{limit}",
    ]);
    return substitute(
      template,
      formatBytes(reason.actual),
      formatBytes(reason.limit)
    );
  });

  return parts.join(" ");
}

/**
 * Create a snippet from form data and add it to the list.
 *
 * Returns the created snippet on success because the caller needs its id to
 * address it — the store owns the write, but the route owns the location, and
 * making the caller re-derive the id from the list would be a race with the
 * storage-change listener.
 *
 * On a quota refusal it raises the banner and hands back the explanation. The
 * create view is deliberately left open by the caller in that case: closing it
 * unmounts `NewSnippetView`, which is the component that *renders* the error, so
 * the message was set and then made invisible.
 */
export async function addSnippet(
  draft: SnippetFormData
): Promise<WriteOutcome<Snippet>> {
  const snippet = createSnippet(draft);
  try {
    await saveSnippetToStorage(snippet);
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: [...prev.snippets, snippet],
    }));
    return { ok: true, value: snippet };
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      // The banner is raised here rather than at the call site so it stays up:
      // the caller only has to render what it is told.
      snippetsStore.setState((prev) => ({
        ...prev,
        quotaWarning: true,
      }));
      return { ok: false, error: quotaMessage(error) };
    }
    captureError(error, { action: "saveSnippet" });
    return { ok: false, error: i18n.t("dashboard.errors.failedToCreate") };
  }
}

export async function editSnippet(
  snippet: Snippet
): Promise<WriteOutcome<Snippet>> {
  try {
    await updateSnippetInStorage(snippet);
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: prev.snippets.map((s) => (s.id === snippet.id ? snippet : s)),
    }));
    return { ok: true, value: snippet };
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      snippetsStore.setState((prev) => ({ ...prev, quotaWarning: true }));
      return { ok: false, error: quotaMessage(error) };
    }
    captureError(error, { action: "updateSnippet" });
    return { ok: false, error: i18n.t("dashboard.errors.failedToUpdate") };
  }
}

/**
 * Delete a snippet and return what is left.
 *
 * Returns the surviving list because the caller needs it to move the address —
 * deleting the snippet the URL points at leaves that URL dangling. Returning it
 * here saves the caller reading the store between the delete and the navigation.
 *
 * The error is reported *and* rethrown. The caller rethrows for its own callers
 * (the confirm dialog's error path), and swallowing it would leave the delete
 * dialog claiming success over a snippet that is still there.
 */
export async function removeSnippet(
  snippetId: string
): Promise<{ remaining: Snippet[] }> {
  try {
    await deleteSnippetFromStorage(snippetId);
    const remaining = snippetsStore.state.snippets.filter(
      (s) => s.id !== snippetId
    );
    snippetsStore.setState((prev) => ({ ...prev, snippets: remaining }));
    return { remaining };
  } catch (error) {
    console.error("[Clipio] Failed to delete snippet:", error);
    captureError(error, { action: "deleteSnippet" });
    throw error;
  }
}

/**
 * Restore the recovered backup and return the refreshed library.
 *
 * The recovered snippets are written wholesale and the library is re-read
 * afterwards rather than appended optimistically: `bulkSaveSnippets` normalises
 * what it stores, so the objects in hand are not necessarily what came back.
 *
 * The refreshed list is returned, not left for the caller to read off the store.
 * A caller reading it from its own render-time value would pick from the library
 * *as it was before the restore* — which is how this banner's "select the newest
 * recovered snippet" ended up addressing something the restore had just replaced.
 */
export async function restoreRecoveredSnippets(): Promise<
  WriteOutcome<Snippet[]>
> {
  const { recoverySnippets } = snippetsStore.state;
  try {
    await bulkSaveSnippets(recoverySnippets);
    const list = await getSnippetsFromStorage();
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: list,
      isLoaded: true,
      showRecoveryBanner: false,
      recoverySnippets: [],
      recoveryError: null,
    }));
    return { ok: true, value: list };
  } catch (error) {
    console.error("[Clipio] Recovery failed:", error);
    captureError(error, { action: "recoverSnippets" });
    snippetsStore.setState((prev) => ({
      ...prev,
      recoveryError: i18n.t("dashboard.errors.failedToRestore"),
    }));
    return { ok: false, error: i18n.t("dashboard.errors.failedToRestore") };
  }
}

// ---------------------------------------------------------------------------
// Dismissals
// ---------------------------------------------------------------------------

/**
 * The three banners and the two errors the user can clear.
 *
 * Plain actions rather than exposed setters. `setState` takes the whole state
 * here, so a component cannot clear a banner without having the entire store in
 * hand — which is the shape that made `useState`'s setter the only option before.
 *
 * Dismissal does not change the underlying fact. A dismissed quota banner comes
 * back on the next `loadSnippets`, because the next refused write re-raises it
 * too. That is deliberate: the banner is not a notification to be consumed, it is
 * a statement about storage that stays true until it stops being true.
 */

export function dismissRecoveryBanner(): void {
  snippetsStore.setState((prev) => ({ ...prev, showRecoveryBanner: false }));
}

export function dismissQuotaWarning(): void {
  snippetsStore.setState((prev) => ({ ...prev, quotaWarning: false }));
}

export function dismissSyncPausedWarning(): void {
  snippetsStore.setState((prev) => ({ ...prev, syncPausedWarning: false }));
}

export function dismissLoadError(): void {
  snippetsStore.setState((prev) => ({ ...prev, loadError: null }));
}

export function dismissRecoveryError(): void {
  snippetsStore.setState((prev) => ({ ...prev, recoveryError: null }));
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

/**
 * The snippet a route id addresses, or `null`.
 *
 * Takes the list rather than the whole state, because the call site has the list
 * and the id and nothing else — making it thread a synthetic `SnippetsState`
 * through would be ceremony for its own sake.
 *
 * A plain function rather than a stored field, because the id lives in the URL
 * and the object in `snippets` — two inputs, one answer, computed on read. See
 * the note at the top of this file.
 */
export function findSnippet(
  snippets: readonly Snippet[],
  snippetId: string | null
): Snippet | null {
  if (!snippetId) return null;
  return snippets.find((s) => s.id === snippetId) ?? null;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

/**
 * Reset the store to its initial state.
 *
 * Exported for tests only. It also bumps `loadGeneration`, so a test that leaves
 * an in-flight `loadSnippets` behind cannot have it land in the next test's
 * store — the guard is the same one production uses, not a second mechanism.
 */
export function resetSnippetsStoreForTests(): void {
  loadGeneration++;
  snippetsStore.setState(() => ({
    snippets: [],
    isLoaded: false,
    loadError: null,
    quotaWarning: false,
    syncPausedWarning: false,
    recoverySnippets: [],
    showRecoveryBanner: false,
    recoveryError: null,
  }));
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

/** Subscribe to one slice of the snippets store. */
export function useSnippets<T>(selector: (state: SnippetsState) => T): T {
  return useStore(snippetsStore, selector);
}
