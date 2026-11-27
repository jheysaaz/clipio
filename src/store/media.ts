/**
 * The media library, as a store.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `ImagesSection.tsx` held eleven `useState` slices and did its own bookkeeping
 * in the component. Two things came out of that, and both were reachable.
 *
 * **The reference map was rebuilt by hand, inline.** Which snippets reference an
 * image is the thing that stops a user deleting an image a snippet still needs,
 * so it is worth a name and a test. It was a `for` loop inside a `useEffect`,
 * which put it below the coverage floor and out of reach.
 *
 * **Object URLs were tracked in a `useRef` with no owner.** Created in the load
 * effect, revoked on unmount, and revoked again on delete — with the deletion
 * path mutating `objectUrlsRef.current` by hand. A ref is invisible to any store
 * and survives nothing useful: unmount order is not something a component
 * controls. Here they are a resource the store creates and releases, with one
 * `dispose` that revokes whatever is outstanding.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import type { Snippet } from "@/types";
import type { MediaMetadata } from "@/storage/backends/media";
import {
  deleteMedia,
  getMedia,
  listMedia,
  updateMediaAlt,
} from "@/storage/backends/media";
import { getSnippets } from "@/storage";
import { extractImageIds } from "@/lib/media-placeholders";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";

/** A snippet that embeds an image, with both its id and the label a user reads. */
export type SnippetReference = {
  id: string;
  label: string;
};

/** One row of the library: its metadata, a URL to show, and what uses it. */
export type ImageItem = {
  meta: MediaMetadata;
  /** `null` when the blob was unreadable — the row still lists, without a preview. */
  objectUrl: string | null;
  /**
   * Snippets whose content references this image.
   *
   * Both halves are needed: the label for the delete warning and the "Used in"
   * list, the id to turn that list into a link that opens the right snippet.
   * Deduplicated by id — two snippets may share a label but are still two
   * different places the image is used.
   */
  referencingSnippets: SnippetReference[];
};

export type MediaState = {
  items: ImageItem[];
  /** Whether the first read has settled. */
  loading: boolean;
  /** Set when the read failed. */
  loadError: string | null;
  /** Per-image delete failures, keyed by media id. */
  deleteErrors: Record<string, string>;
  /** The image the delete dialog is open for, if any. */
  confirmDeleteId: string | null;
  viewMode: "list" | "grid";
  /** Per-image alt-text the user is editing, keyed by media id. */
  altDraft: Record<string, string>;
  /** Per-image "Saved" flash, keyed by media id. */
  altSaved: Record<string, boolean>;
  /** Per-image alt-text failures, keyed by media id. */
  altErrors: Record<string, string>;
};

export const mediaStore = createStore<MediaState>({
  items: [],
  loading: true,
  loadError: null,
  deleteErrors: {},
  confirmDeleteId: null,
  // Grid is the default: thumbnails answer "which image is this?" faster than a
  // list of ids, and the list view stays one click away.
  viewMode: "grid",
  altDraft: {},
  altSaved: {},
  altErrors: {},
});

/**
 * Which snippets reference which image.
 *
 * Pure, and the most consequential function in this file: it is what stands
 * between a user and an image a snippet still needs. Its previous home was a
 * nested loop inside a load effect, where nothing could assert it.
 *
 * Deduplicates by snippet id, not label: two snippets called "Greeting" are two
 * links the user may need to follow. Repeating one id inside a snippet is still
 * one reference. Order follows the library order, so the list does not reshuffle
 * between loads.
 */
export function buildReferenceMap(
  snippets: readonly Snippet[]
): Record<string, SnippetReference[]> {
  const refMap: Record<string, SnippetReference[]> = {};
  for (const snippet of snippets) {
    for (const id of extractImageIds(snippet.content)) {
      if (!refMap[id]) refMap[id] = [];
      if (!refMap[id].some((ref) => ref.id === snippet.id)) {
        refMap[id].push({ id: snippet.id, label: snippet.label });
      }
    }
  }
  return refMap;
}

// ---------------------------------------------------------------------------
// Object URLs
// ---------------------------------------------------------------------------

/**
 * Outstanding object URLs, so they can all be revoked.
 *
 * A module-level set rather than component state because a resource outliving the
 * component that made it is the whole problem: the load effect creates one per
 * row, and the component that must revoke them is not the one that ran it.
 */
const outstandingObjectUrls = new Set<string>();

/** Revoke every object URL this store created. Safe to call more than once. */
export function disposeObjectUrls(): void {
  for (const url of outstandingObjectUrls) URL.revokeObjectURL(url);
  outstandingObjectUrls.clear();
}

/**
 * Revoke one row's URL, if it has one.
 *
 * On its own rather than as part of `removeMedia`, because an image can be
 * deleted elsewhere — the options page and the editor are separate contexts — and
 * a refresh would otherwise strand the URL.
 */
function releaseObjectUrl(id: string): void {
  const item = mediaStore.state.items.find((i) => i.meta.id === id);
  if (!item?.objectUrl) return;
  URL.revokeObjectURL(item.objectUrl);
  outstandingObjectUrls.delete(item.objectUrl);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Whether a read that has already finished should still be applied.
 *
 * The unmount case is why this exists: the load creates object URLs as it goes,
 * so a component that unmounts mid-read would leak them unless the finished read
 * either applied its results and let `dispose` revoke them, or discarded both.
 */
let loadGeneration = 0;

export async function loadMediaLibrary(): Promise<void> {
  // A section switch unmounts Images while its last description write may still
  // be in flight. Read after that write, or the new mount would seed its drafts
  // from the pre-edit metadata and show the old text again.
  if (pendingAltFlush) await pendingAltFlush;

  const generation = ++loadGeneration;
  const isStale = () => generation !== loadGeneration;

  mediaStore.setState((prev) => ({ ...prev, loading: true }));

  try {
    const [mediaList, snippets] = await Promise.all([
      listMedia(),
      getSnippets(),
    ]);
    if (isStale()) return;

    const refMap = buildReferenceMap(snippets);

    const resolved: ImageItem[] = await Promise.all(
      mediaList.map(async (meta) => {
        try {
          const entry = await getMedia(meta.id);
          if (entry?.blob) {
            const url = URL.createObjectURL(entry.blob);
            outstandingObjectUrls.add(url);
            return {
              meta,
              objectUrl: url,
              referencingSnippets: refMap[meta.id] ?? [],
            };
          }
        } catch {
          // An unreadable entry is still listed — the user needs to see it in
          // order to delete it. Falling through gives a row with no preview.
        }
        return {
          meta,
          objectUrl: null,
          referencingSnippets: refMap[meta.id] ?? [],
        };
      })
    );

    if (isStale()) return;
    mediaStore.setState((prev) => ({
      ...prev,
      items: resolved,
      altDraft: Object.fromEntries(
        resolved.map((item) => [item.meta.id, item.meta.alt ?? ""])
      ),
      loading: false,
    }));
  } catch (error) {
    if (isStale()) return;
    captureError(error, { action: "imagesSection.load" });
    mediaStore.setState((prev) => ({
      ...prev,
      loading: false,
      loadError: i18n.t("options.images.errors.failedToLoad"),
    }));
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** How long the user can keep typing before a description is committed. */
export const ALT_SAVE_DEBOUNCE_MS = 600;
/** How long the saved check stays visible. */
export const ALT_SAVED_FLASH_MS = 2000;

type QueuedAltSave = {
  timer: ReturnType<typeof setTimeout>;
  version: number;
  generation: number;
  session: number;
};

const altSaveQueue = new Map<string, QueuedAltSave>();
const altFlashTimers = new Map<string, ReturnType<typeof setTimeout>>();
const altSaveVersions = new Map<string, number>();
let altSaveGeneration = 0;
/**
 * Bumped when Images unmounts. An edit already in flight may still commit, but
 * it must not light a "Saved" badge in the section that mounts afterwards.
 */
let altSessionGeneration = 0;
/** Writes in progress, including ones started before a section switched. */
const altInFlight = new Set<Promise<boolean>>();
/** Writes started by a section switch; a new load waits for them. */
let pendingAltFlush: Promise<void> | null = null;

function trackAltWrite(write: Promise<boolean>): Promise<boolean> {
  altInFlight.add(write);
  void write.finally(() => altInFlight.delete(write));
  return write;
}

export function setAltDraft(id: string, value: string): void {
  mediaStore.setState((prev) => ({
    ...prev,
    altDraft: { ...prev.altDraft, [id]: value },
  }));
}

/**
 * Queue a description write after the user stops typing.
 *
 * No Save button means the component calls this on every change, so the timer is
 * the throttle. A version is captured with each queue: a slower earlier write
 * must not overwrite a later one when IndexedDB answers out of order.
 */
export function scheduleAltSave(
  id: string,
  delayMs = ALT_SAVE_DEBOUNCE_MS
): void {
  const version = (altSaveVersions.get(id) ?? 0) + 1;
  altSaveVersions.set(id, version);
  const generation = altSaveGeneration;

  const pending = altSaveQueue.get(id);
  if (pending) clearTimeout(pending.timer);

  const session = altSessionGeneration;
  const timer = setTimeout(() => {
    altSaveQueue.delete(id);
    void trackAltWrite(saveAlt(id, version, generation, session));
  }, delayMs);
  altSaveQueue.set(id, { timer, version, generation, session });
}

/**
 * Commit queued edits when Images unmounts instead of dropping them.
 *
 * Switching options sections is an in-document navigation: the component goes
 * away, but the store and document do not. Cancelling here silently lost the
 * last keystrokes before the debounce fired. The saved flashes are cleared as
 * part of teardown so returning to Images cannot show a stale check.
 */
export function flushPendingAltSaves(): Promise<void> {
  altSessionGeneration++;
  clearAltSavedFlashes();

  const queued = [...altSaveQueue.entries()];
  for (const [, save] of queued) clearTimeout(save.timer);
  altSaveQueue.clear();
  if (queued.length === 0 && altInFlight.size === 0) {
    return pendingAltFlush ?? Promise.resolve();
  }

  const previous = pendingAltFlush ?? Promise.resolve();
  const writes = queued.map(([id, save]) =>
    trackAltWrite(saveAlt(id, save.version, save.generation, save.session))
  );
  const next = previous.then(async () => {
    await Promise.all([...writes, ...altInFlight]);
  });
  pendingAltFlush = next;
  void next.finally(() => {
    if (pendingAltFlush === next) pendingAltFlush = null;
  });
  return next;
}

/**
 * Hard-cancel queued writes and invalidate writes already in flight.
 *
 * Only test resets use this now. Bumping the generation means a write from the
 * old state cannot land after the reset and silently change the new state.
 */
export function cancelPendingAltSaves(): void {
  altSaveGeneration++;
  altSessionGeneration++;
  for (const { timer } of altSaveQueue.values()) clearTimeout(timer);
  for (const timer of altFlashTimers.values()) clearTimeout(timer);
  altSaveQueue.clear();
  altFlashTimers.clear();
  altSaveVersions.clear();
  pendingAltFlush = null;
}

function clearAltSavedFlashes(): void {
  for (const timer of altFlashTimers.values()) clearTimeout(timer);
  altFlashTimers.clear();
  mediaStore.setState((prev) => ({
    ...prev,
    altSaved: Object.fromEntries(
      Object.keys(prev.altSaved).map((id) => [id, false])
    ),
  }));
}

function isCurrentAltSave(
  id: string,
  version: number,
  generation: number
): boolean {
  return (
    generation === altSaveGeneration &&
    (altSaveVersions.get(id) ?? 0) === version
  );
}

/**
 * Commit an alt-text edit.
 *
 * Returns whether it saved, so a test can assert the outcome without reading the
 * store — and so a stale or cancelled write is not reported as a failure.
 *
 * A blank draft is stored as `undefined`, not `""`. That is the distinction
 * between "the user cleared the alt text" and "the user never filled it in", and
 * it is what the schema can express; `""` round-tripped into every reader.
 */
export async function saveAlt(
  id: string,
  version = altSaveVersions.get(id) ?? 0,
  generation = altSaveGeneration,
  session = altSessionGeneration
): Promise<boolean> {
  const draft = mediaStore.state.altDraft[id] ?? "";
  try {
    await updateMediaAlt(id, draft);
    if (!isCurrentAltSave(id, version, generation)) return false;

    const alt = draft.trim() || undefined;
    const showSaved = session === altSessionGeneration;
    mediaStore.setState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.meta.id === id ? { ...item, meta: { ...item.meta, alt } } : item
      ),
      altErrors: { ...prev.altErrors, [id]: "" },
      altSaved: { ...prev.altSaved, [id]: showSaved },
    }));
    if (showSaved) flashAltSaved(id, session);
    return true;
  } catch {
    if (!isCurrentAltSave(id, version, generation)) return false;
    mediaStore.setState((prev) => ({
      ...prev,
      altErrors: {
        ...prev.altErrors,
        [id]: i18n.t("options.images.errors.failedToSaveDescription"),
      },
      altSaved: { ...prev.altSaved, [id]: false },
    }));
    return false;
  }
}

function flashAltSaved(id: string, session: number): void {
  if (session !== altSessionGeneration) return;
  const existing = altFlashTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    altFlashTimers.delete(id);
    clearAltSaved(id);
  }, ALT_SAVED_FLASH_MS);
  altFlashTimers.set(id, timer);
}

export function clearAltSaved(id: string): void {
  mediaStore.setState((prev) => ({
    ...prev,
    altSaved: { ...prev.altSaved, [id]: false },
  }));
}

export async function removeMedia(id: string): Promise<boolean> {
  try {
    await deleteMedia(id);
    releaseObjectUrl(id);
    mediaStore.setState((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.meta.id !== id),
      confirmDeleteId: null,
    }));
    return true;
  } catch (error) {
    captureError(error, { action: "imagesSection.delete", imageId: id });
    mediaStore.setState((prev) => ({
      ...prev,
      // The dialog closes either way. Leaving it open over an error it cannot
      // render — `deleteErrors` is keyed by id and the dialog has no slot for it —
      // would strand the user mid-action.
      confirmDeleteId: null,
      deleteErrors: {
        ...prev.deleteErrors,
        [id]: i18n.t("options.images.errors.failedToDelete"),
      },
    }));
    return false;
  }
}

export function requestDelete(id: string): void {
  mediaStore.setState((prev) => ({ ...prev, confirmDeleteId: id }));
}

export function cancelDelete(): void {
  mediaStore.setState((prev) => ({ ...prev, confirmDeleteId: null }));
}

export function dismissDeleteError(id: string): void {
  mediaStore.setState((prev) => {
    if (!prev.deleteErrors[id]) return prev;
    const next = { ...prev.deleteErrors };
    delete next[id];
    return { ...prev, deleteErrors: next };
  });
}

export function dismissLoadError(): void {
  mediaStore.setState((prev) => ({ ...prev, loadError: null }));
}

export function setViewMode(mode: "list" | "grid"): void {
  mediaStore.setState((prev) => ({ ...prev, viewMode: mode }));
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

/**
 * Bytes used by the library.
 *
 * Takes the items rather than the state: the caller has the items and one number,
 * and threading a whole `MediaState` through to compute a sum would be ceremony.
 */
export function totalMediaBytes(items: readonly ImageItem[]): number {
  return items.reduce((sum, item) => sum + item.meta.size, 0);
}

/** The row the dialog is open for, if it still exists. */
export function findImageItem(
  items: readonly ImageItem[],
  id: string | null
): ImageItem | null {
  if (!id) return null;
  return items.find((i) => i.meta.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

/**
 * Reset the store, and revoke anything outstanding.
 *
 * Both halves matter: a test that resets state but leaves object URLs behind
 * leaks them into the next test, where the harness's `URL.createObjectURL` count
 * is asserted.
 */
export function resetMediaStoreForTests(): void {
  loadGeneration++;
  cancelPendingAltSaves();
  disposeObjectUrls();
  mediaStore.setState(() => ({
    items: [],
    loading: true,
    loadError: null,
    deleteErrors: {},
    confirmDeleteId: null,
    viewMode: "grid",
    altDraft: {},
    altSaved: {},
    altErrors: {},
  }));
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

/** Subscribe to one slice of the media store. */
export function useMedia<T>(selector: (state: MediaState) => T): T {
  return useStore(mediaStore, selector);
}
