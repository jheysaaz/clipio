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
   * The create form's contents.
   *
   * In the store rather than in the component because it is not really the
   * component's: the form is filled from a context-menu selection *before* the
   * component mounts the create view, and the pasted text has to survive the route
   * moving to `#/new`. Component state started empty every time, which is how
   * "Save selection" could open a form with nothing in it.
   */
  draft: SnippetFormData;
  /** Whether a create is in flight, so the button can disable itself. */
  isSaving: boolean;
  /** Why the last create failed, or `null`. Rendered inside the create form. */
  createError: string | null;
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

/** A blank create form. Shared so "reset to blank" is one definition. */
export const EMPTY_DRAFT: SnippetsState["draft"] = {
  label: "",
  shortcut: "",
  content: "",
  tags: [],
};

export const snippetsStore = createStore<SnippetsState>({
  draft: { ...EMPTY_DRAFT },
  isSaving: false,
  createError: null,
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
 * Orders every read of the library, whatever asked for it.
 *
 * `loadSnippets` runs on mount and `refreshSnippets` runs from the
 * storage-change listener, and the two overlap constantly — a snippet saved in
 * another context fires the listener while the initial read is still in flight.
 * On `storage.sync` that is two network round-trips, so the code does not get to
 * assume which lands first.
 *
 * Each read takes a ticket when it is *issued* and applies its result only if it
 * is still the newest. The bug this prevents is the one an earlier version had:
 * the counter was bumped only by `loadSnippets`, so a slow listener refresh
 * resolved after a newer load and wiped the library — the snippet the user had
 * just created vanished from the sidebar and stayed gone. Its own docstring
 * described that exact scenario while not defending against it.
 */
let readTicket = 0;

/** Take a ticket, and get a predicate saying whether it is still the newest. */
function takeTicket(): { isStale: () => boolean } {
  const ticket = ++readTicket;
  return { isStale: () => ticket !== readTicket };
}

/**
 * Recompute the storage warnings from a status read.
 *
 * Split out because a status read can fail on its own, and lumping it in with
 * the library read made its failure indistinguishable: the `catch` set
 * `loadError`, so `Dashboard` rendered "Failed to load snippets." in place of a
 * library that was in memory and correct. The user was told their snippets were
 * lost, and they were not.
 */
async function applyStorageStatus(isStale: () => boolean): Promise<void> {
  let status: Awaited<ReturnType<typeof getStorageStatus>>;
  try {
    status = await getStorageStatus();
  } catch (error) {
    // Reported, and nothing else. The warnings stay at whatever they were, which
    // is the safe direction: a banner the user has already dismissed does not
    // reappear because one status read failed.
    captureError(error, { action: "getStorageStatus" });
    return;
  }
  if (isStale()) return;
  snippetsStore.setState((prev) => ({
    ...prev,
    quotaWarning: status.quotaExceeded,
    // Quota is the more urgent of the two, so it wins. Showing both would tell the
    // user their edits are not syncing *and* that there is no room, which is one
    // problem described twice.
    syncPausedWarning:
      !status.quotaExceeded &&
      status.mode === "local" &&
      status.localReason === "manual",
  }));
}

export async function loadSnippets(): Promise<void> {
  const { isStale } = takeTicket();

  try {
    const list = await getSnippetsFromStorage();
    if (isStale()) return;
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: list,
      // Set on success and on failure alike. A library that has arrived is loaded;
      // leaving this false would keep the dashboard spinning over content it
      // already has.
      isLoaded: true,
    }));
  } catch (error) {
    if (isStale()) return;
    console.error("[Clipio] Failed to load snippets:", error);
    captureError(error, { action: "loadSnippets" });
    snippetsStore.setState((prev) => ({
      ...prev,
      isLoaded: true,
      loadError: i18n.t("dashboard.errors.failedToLoad"),
    }));
    return;
  }

  await applyStorageStatus(isStale);
}

/**
 * Re-read after a change made in another context.
 *
 * Takes a ticket like `loadSnippets` does, which is the point: without that, a
 * refresh in flight when the user creates a snippet would land afterwards with a
 * list that predates it and erase it.
 *
 * Recomputes the warnings as well as the list. A library that crosses the quota
 * limit in the options page while a popup is open must raise the banner there —
 * the docstring on the dismiss actions calls them "a statement about storage that
 * stays true until it stops being true", and that is not true of a path that only
 * ever re-reads the list.
 */
export async function refreshSnippets(): Promise<void> {
  const { isStale } = takeTicket();
  try {
    const list = await getSnippetsFromStorage();
    if (isStale()) return;
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: list,
      isLoaded: true,
    }));
  } catch (error) {
    // A failed refresh must not clear the list the user is reading, and must not
    // be reported as a failed load — the previous load may well have succeeded.
    // `isLoaded` is settled anyway, so a failure on a *first* read cannot leave a
    // spinner running with no error to show.
    captureError(error, { action: "snippets.refresh" });
    snippetsStore.setState((prev) => ({
      ...prev,
      isLoaded: prev.isLoaded || prev.snippets.length > 0,
    }));
    return;
  }
  await applyStorageStatus(isStale);
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
/**
 * Re-read when a snippet key changes in any storage area.
 *
 * Not torn down. The store lives as long as the document does, and the document
 * going away is what ends it — the same reasoning as the `uiFontItem.watch` in
 * `settings.ts`. An unused `_dispose` export existed there for a moment and was a
 * promise nobody kept.
 *
 * Every area is watched, not just the active one, because the manager's mode can
 * change while the popup is open. `refreshSnippets` re-reads through the manager,
 * which always reads the right area, so a change in the *inactive* one is simply
 * a no-op read. That is also why this listener cannot be filtered by area: after
 * one sync→local switch `forceSetMode` leaves the same `snip:<id>` keys in both
 * areas, so filtering would drop exactly the events that matter.
 *
 * The read is `refreshSnippets`, which takes a read ticket. It has to share the
 * ticket sequence `loadSnippets` uses: a refresh that landed after a newer load
 * would otherwise wipe the library.
 */
if (typeof browser !== "undefined" && browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    const touched = Object.keys(changes).some((key) =>
      key.startsWith(SNIPPET_KEY_PREFIX)
    );
    if (!touched) return;

    void refreshSnippets().catch((error: unknown) => {
      // `refreshSnippets` handles its own failures, so reaching here means
      // something threw outside its try — worth knowing about, and worth
      // attributing to the area it came from.
      captureError(error, { action: "snippets.refresh.listen", areaName });
    });
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** The outcome of a write, so callers can react to a refusal. */
export type WriteOutcome<T = void> =
  { ok: true; value: T } | { ok: false; error: string };

/**
 * A write the backend refused for a reason the user can act on.
 *
 * Its own type, not a plain `Error`, because the two need opposite handling and
 * were being given the same one. A *refusal* — storage over quota — is an
 * expected condition with an actionable explanation already computed. Routing it
 * through `captureError` filed a Sentry exception on every occurrence carrying
 * localised user-facing copy; routing it through a bare `new Error(message)` had
 * callers show a generic "please try again" and throw away the limit detail the
 * store had just computed.
 *
 * So: a refusal is thrown as this, callers render `userMessage`, and nothing
 * reports it to Sentry. A genuine failure is still an ordinary `Error` and is
 * still reported.
 */
export class SnippetWriteRefused extends Error {
  /** The explanation to show, already localised. */
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "SnippetWriteRefused";
    this.userMessage = userMessage;
  }
}

/** Whether a caught value is a refusal rather than a genuine failure. */
export function isWriteRefusal(error: unknown): error is SnippetWriteRefused {
  return error instanceof SnippetWriteRefused;
}

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
 * Put one snippet into the list, replacing any row already holding its id.
 *
 * The list is a set of rows keyed by id — the sidebar renders it with
 * `key={snippet.id}` and the detail pane addresses it by id — so appending is
 * only correct when the row is genuinely new.
 *
 * It often is not. `addSnippet`'s own write fires `browser.storage.onChanged`,
 * which drives `refreshSnippets`, and that replaces the whole list with what
 * storage holds. If the re-read is applied before the optimistic append, the list
 * *already* holds the snippet and a plain append put a second row for it on top:
 * the sidebar showed the snippet the user had just created twice, while storage
 * held exactly one. Which order wins is not the store's to decide — the re-read
 * takes a read ticket and both paths are asynchronous — so the merge has to be
 * correct whichever way it falls.
 *
 * Replacing rather than skipping matters for the same reason: the re-read returns
 * a normalised object, so the row it installed and the one in hand are equal in
 * identity but not necessarily in content. Taking the freshest wins.
 */
function upsertRow(list: readonly Snippet[], snippet: Snippet): Snippet[] {
  const index = list.findIndex((s) => s.id === snippet.id);
  if (index === -1) return [...list, snippet];
  const next = list.slice();
  next[index] = snippet;
  return next;
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
  snippetsStore.setState((prev) => ({
    ...prev,
    isSaving: true,
    createError: null,
  }));
  try {
    await saveSnippetToStorage(snippet);
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: upsertRow(prev.snippets, snippet),
      isSaving: false,
      // Cleared on success only. On failure the draft is deliberately left alone
      // so the user can shorten the snippet and retry without retyping it.
      draft: { ...EMPTY_DRAFT },
    }));
    return { ok: true, value: snippet };
  } catch (error) {
    let message: string;
    if (error instanceof StorageQuotaError) {
      // The banner is raised here rather than at the call site so it stays up: the
      // caller only has to render what it is told.
      snippetsStore.setState((prev) => ({ ...prev, quotaWarning: true }));
      message = quotaMessage(error);
    } else {
      captureError(error, { action: "saveSnippet" });
      message = i18n.t("dashboard.errors.failedToCreate");
    }
    // The draft is deliberately left alone here, so the user can shorten the
    // snippet and retry without retyping it.
    snippetsStore.setState((prev) => ({
      ...prev,
      isSaving: false,
      createError: message,
    }));
    return { ok: false, error: message };
  }
}

/**
 * Save an edited snippet.
 *
 * **Throws**, unlike `addSnippet`, because every caller of this one already has a
 * `try`/`catch` that renders a failure — the detail view and the inline rename.
 * Returning a result made `Dashboard` convert it back into a throw, and the value
 * it threw was the localised explanation, which the catch then discarded in favour
 * of a generic message while filing the localised string to Sentry.
 *
 * A quota refusal throws `SnippetWriteRefused` and is *not* reported: it is an
 * expected condition with an actionable explanation, and the banner is raised here
 * so it stays up. A genuine failure is reported, once, here.
 */
export async function editSnippet(snippet: Snippet): Promise<Snippet> {
  try {
    await updateSnippetInStorage(snippet);
    snippetsStore.setState((prev) => ({
      ...prev,
      snippets: prev.snippets.map((s) => (s.id === snippet.id ? snippet : s)),
    }));
    return snippet;
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      snippetsStore.setState((prev) => ({ ...prev, quotaWarning: true }));
      throw new SnippetWriteRefused(quotaMessage(error));
    }
    captureError(error, { action: "updateSnippet" });
    throw new SnippetWriteRefused(i18n.t("dashboard.errors.failedToUpdate"));
  }
}

/**
 * Delete a snippet and return what is left.
 *
 * Returns the surviving list because the caller needs it to move the address —
 * deleting the snippet the URL points at leaves that URL dangling. Returning it
 * here saves the caller reading the store between the delete and the navigation.
 *
 * A quota refusal throws `SnippetWriteRefused` and is not reported; anything else
 * is reported here, once, and rethrown unchanged so the delete dialog cannot
 * claim success over a snippet that is still there.
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
    if (error instanceof StorageQuotaError) {
      // A refusal to delete is nearly always a refusal to write the tombstone, so
      // the quota banner is the right thing to raise.
      snippetsStore.setState((prev) => ({ ...prev, quotaWarning: true }));
      throw new SnippetWriteRefused(quotaMessage(error));
    }
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
// The create form
// ---------------------------------------------------------------------------

/**
 * Put a draft on screen.
 *
 * A context-menu selection arrives with a shortcut of `/` rather than empty: the
 * field is required, and pre-filling it means the user can type a name and press
 * save instead of filling everything in from scratch. An empty default would make
 * the form look broken next to a filled-in label.
 */
export function setDraft(draft: SnippetFormData): void {
  snippetsStore.setState((prev) => ({
    ...prev,
    draft,
    // A new draft clears the previous attempt's error, or the user sees a stale
    // "quota exceeded" against text they have not typed yet.
    createError: null,
  }));
}

export function clearDraft(): void {
  setDraft({ ...EMPTY_DRAFT });
}

export function setIsSaving(isSaving: boolean): void {
  snippetsStore.setState((prev) => ({ ...prev, isSaving }));
}

export function dismissCreateError(): void {
  snippetsStore.setState((prev) => ({ ...prev, createError: null }));
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
 * Exported for tests only. It also invalidates outstanding read tickets, so a test
 * that leaves an in-flight read behind cannot have it land in the next test's
 * store — the guard is the same one production uses, not a second mechanism.
 */
export function resetSnippetsStoreForTests(): void {
  readTicket++;
  snippetsStore.setState(() => ({
    draft: { ...EMPTY_DRAFT },
    isSaving: false,
    createError: null,
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
