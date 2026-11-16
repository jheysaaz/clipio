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

/** One row of the library: its metadata, a URL to show, and what uses it. */
export type ImageItem = {
  meta: MediaMetadata;
  /** `null` when the blob was unreadable — the row still lists, without a preview. */
  objectUrl: string | null;
  /**
   * Labels of the snippets whose content references this image.
   *
   * Labels rather than ids because this is shown to the user in the delete
   * confirmation, and a label is what they recognise. Deduplicated, because the
   * same image in two snippets of the same name is one thing to warn about.
   */
  referencingSnippets: string[];
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
  viewMode: "list",
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
 * Deduplicates labels per image, because a user with `/greeting` in four
 * snippets called "Greeting" should see one warning, not four. Order follows the
 * library order, so the list does not reshuffle between loads.
 */
export function buildReferenceMap(
  snippets: readonly Snippet[]
): Record<string, string[]> {
  const refMap: Record<string, string[]> = {};
  for (const snippet of snippets) {
    for (const id of extractImageIds(snippet.content)) {
      if (!refMap[id]) refMap[id] = [];
      if (!refMap[id].includes(snippet.label)) {
        refMap[id].push(snippet.label);
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

export function setAltDraft(id: string, value: string): void {
  mediaStore.setState((prev) => ({
    ...prev,
    altDraft: { ...prev.altDraft, [id]: value },
  }));
}

/**
 * Commit an alt-text edit.
 *
 * Returns whether it saved, so the caller can decide about focus — and so a test
 * can assert the outcome without reading the store.
 *
 * A blank draft is stored as `undefined`, not `""`. That is the distinction
 * between "the user cleared the alt text" and "the user never filled it in", and
 * it is what the schema can express; `""` round-tripped into every reader.
 */
export async function saveAlt(id: string): Promise<boolean> {
  const draft = mediaStore.state.altDraft[id] ?? "";
  try {
    await updateMediaAlt(id, draft);
    const alt = draft.trim() || undefined;
    mediaStore.setState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.meta.id === id ? { ...item, meta: { ...item.meta, alt } } : item
      ),
      altErrors: { ...prev.altErrors, [id]: "" },
      altSaved: { ...prev.altSaved, [id]: true },
    }));
    return true;
  } catch {
    mediaStore.setState((prev) => ({
      ...prev,
      altErrors: {
        ...prev.altErrors,
        [id]: i18n.t("options.images.errors.failedToSaveDescription"),
      },
    }));
    return false;
  }
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
  disposeObjectUrls();
  mediaStore.setState(() => ({
    items: [],
    loading: true,
    loadError: null,
    deleteErrors: {},
    confirmDeleteId: null,
    viewMode: "list",
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
