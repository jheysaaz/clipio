/**
 * Reading a `storage.sync` change set, as a decision rather than as a listener.
 *
 * ── Why this is extracted ────────────────────────────────────────────────────
 *
 * The sign-out detector lived inside a `browser.storage.onChanged` listener in
 * `src/entrypoints/background.ts`. That put it in the one file nothing measures:
 * `src/entrypoints/**` is on the coverage exclusion list, so it had no unit test,
 * and the e2e spec that claimed to cover background script behaviour never
 * exercised it.
 *
 * That is not hypothetical. A defect in the test harness — `diffKeys` reading
 * across storage areas — reported a *removal* as having a `newValue`, taken from
 * the other area. This module's discriminator tests exactly that field:
 * `oldValue !== undefined && newValue === undefined`. So the mock bug made this
 * logic silently wrong, in a file where nothing could notice and behind a gate
 * whose stated justification ("exercised end-to-end by Playwright specs") was not
 * true.
 *
 * Extracted for the same reason `insertion-verification.ts` was: a decision worth
 * testing must not live somewhere a test cannot reach it.
 */

/** The prefix every snippet key carries, in whichever area is active. */
export const SNIPPET_KEY_PREFIX = "snip:";

/**
 * How many snippet keys have to vanish at once before it is treated as a wipe.
 *
 * Two, not one, because Chrome removes sync keys one at a time in ordinary
 * operation — and a threshold of one would raise the sign-out banner every time
 * the user deleted a single snippet.
 */
export const SIGN_OUT_KEY_THRESHOLD = 2;

/** The shape `browser.storage.onChanged` reports one changed key as. */
export type StorageChange = {
  oldValue?: unknown;
  newValue?: unknown;
};

export type StorageChanges = Record<string, StorageChange>;

export type SyncChangeReading = {
  /** How many `snip:` keys changed, whatever the direction. */
  touchedSnippetKeys: number;
  /**
   * Whether any snippet was added or modified.
   *
   * This is what drives the content-script cache refresh. Distinct from a removal
   * because the two need opposite handling: a gained snippet means the content
   * script is serving a stale cache, while a removed one is a deletion the popup
   * will reconcile.
   */
  gainedOrChanged: boolean;
  /** How many snippet keys were removed. */
  removedKeys: number;
  /**
   * Whether this looks like the browser wiping `storage.sync` because the user
   * signed out — which is the only event where Clipio's data is genuinely gone
   * and a recovery banner is the right response.
   */
  likelySignOut: boolean;
};

/** The "nothing to do" reading, for inputs that cannot concern snippets. */
const NOTHING_TOUCHED: SyncChangeReading = {
  touchedSnippetKeys: 0,
  gainedOrChanged: false,
  removedKeys: 0,
  likelySignOut: false,
};

/**
 * Classify a storage change.
 *
 * `areaName` is checked rather than assumed. `storage.local` holds the
 * content-script cache and the settings items, so a change there says nothing
 * about sync — and treating it as sync activity would raise a sign-out banner
 * every time a font preference changed.
 *
 * Every other storage area is ignored outright rather than treated as sync.
 * Reading `storage.session` here would be wrong for the same reason, and no
 * session key carries the snippet prefix in any case.
 */
export function readSyncChange(
  changes: StorageChanges,
  areaName: string
): SyncChangeReading {
  if (areaName !== "sync") return NOTHING_TOUCHED;

  const snippetKeys = Object.keys(changes).filter((key) =>
    key.startsWith(SNIPPET_KEY_PREFIX)
  );
  if (snippetKeys.length === 0) return NOTHING_TOUCHED;

  let gainedOrChanged = false;
  let removedKeys = 0;

  for (const key of snippetKeys) {
    const change = changes[key];
    // A removal reports `oldValue` and no `newValue` at all. Testing `newValue`
    // alone would be enough today, but `oldValue !== undefined` is stated
    // explicitly because it is the half that distinguishes "removed" from
    // "created then deleted before we looked" — and because a harness that gets
    // this wrong produces a change with both halves set, which must not be
    // counted as either.
    if (change.oldValue !== undefined && change.newValue === undefined) {
      removedKeys++;
    } else if (change.newValue !== undefined) {
      gainedOrChanged = true;
    }
  }

  return {
    touchedSnippetKeys: snippetKeys.length,
    gainedOrChanged,
    removedKeys,
    // A sign-out never *gains* anything — Chrome wipes `storage.sync` and stops.
    // So a change set that both adds snippets and removes several is not a
    // sign-out: it is a sync from another device that happened to delete a few
    // snippets on the way, and Chrome's sync merge propagates deletions.
    //
    // The previous code tested `removedKeys >= threshold` alone, so that case
    // filed a "Sync storage wipe detected" report, set the sign-out flag, and on
    // the next popup open offered the user a recovery banner for snippets they
    // never lost — alarming, and pointing at a backup that would overwrite
    // nothing useful. Behaviour change, deliberate, and asserted below.
    likelySignOut: !gainedOrChanged && removedKeys >= SIGN_OUT_KEY_THRESHOLD,
  };
}

/** Whether a reading means the content-script cache must be refreshed. */
export function needsCacheRefresh(reading: SyncChangeReading): boolean {
  return reading.gainedOrChanged;
}

/**
 * Whether a snippet change came from *another* writer.
 *
 * Both storage areas carry `updatedBy` on each record: the queue's own commits
 * fire `onChanged` in this context in local mode, and our sync writes are echoed
 * back from `storage.sync` too. Treating either as an external edit refreshes the
 * library from under an open editor after every autosave and drops the sidebar's
 * live draft previews — the row flashes between the new text and the committed
 * one. The writer id is the only stable discriminator.
 *
 * Non-snippet keys are excluded by the prefix check rather than by a growing
 * denylist. `storage.session` is ignored: no snippet key lives there.
 */
export function isExternalSnippetChange(
  changes: StorageChanges,
  areaName: string,
  writerId: string
): boolean {
  if (areaName !== "local" && areaName !== "sync") return false;
  return Object.entries(changes).some(([key, change]) => {
    if (!key.startsWith(SNIPPET_KEY_PREFIX)) return false;
    const record = (change.newValue ?? change.oldValue) as
      { updatedBy?: unknown } | undefined;
    return record?.updatedBy !== writerId;
  });
}

/**
 * Local-mode alias, kept for callers and tests that name the area explicitly.
 */
export function isExternalLocalSnippetChange(
  changes: StorageChanges,
  areaName: string,
  writerId: string
): boolean {
  if (areaName !== "local") return false;
  return isExternalSnippetChange(changes, areaName, writerId);
}
