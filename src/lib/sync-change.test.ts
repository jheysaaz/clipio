import { describe, it, expect } from "vitest";

import {
  SIGN_OUT_KEY_THRESHOLD,
  isExternalLocalSnippetChange,
  isExternalSnippetChange,
  needsCacheRefresh,
  readSyncChange,
  type StorageChanges,
} from "./sync-change";

/**
 * The harness bug this module's existence is about.
 *
 * `tests/mocks/browser.ts` used to compute a removal's `newValue` as
 * `syncStore[key] ?? localStore[key]` — reading across areas. After a single
 * sync→local switch `forceSetMode` leaves the same `snip:<id>` in both, so
 * removing one reported `newValue: <the other area's value>`: a change with
 * *both* halves set.
 *
 * That made a removal invisible to the sign-out detector below, and fired the
 * "something was written" branch instead. The mock was load-bearing for the live
 * sync tests and `background.ts` had no test, so nothing noticed. The
 * "both halves set" case below is that exact shape, pinned so the discrimination
 * cannot be re-broken from the consumer side either.
 */

const gained = (id: string): StorageChanges[string] => ({
  oldValue: undefined,
  newValue: { id },
});

const removed = (id: string): StorageChanges[string] => ({
  oldValue: { id },
  newValue: undefined,
});

describe("readSyncChange", () => {
  it("ignores a change in another area", () => {
    // The content-script cache and every settings item live in `local`. Treating
    // that as sync activity would raise a sign-out banner every time the user
    // changed their font.
    const reading = readSyncChange(
      { "local:cachedSnippets": { newValue: [] } },
      "local"
    );

    expect(reading).toEqual({
      touchedSnippetKeys: 0,
      gainedOrChanged: false,
      removedKeys: 0,
      likelySignOut: false,
    });
    expect(reading.likelySignOut).toBe(false);
  });

  it("ignores session storage", () => {
    expect(
      readSyncChange({ "snip:x": gained("x") }, "session").gainedOrChanged
    ).toBe(false);
  });

  it("ignores a sync change to a key that is not a snippet", () => {
    const reading = readSyncChange(
      { themeMode: { newValue: "dark" }, uiFont: { newValue: "inter" } },
      "sync"
    );

    expect(reading.touchedSnippetKeys).toBe(0);
    expect(reading.gainedOrChanged).toBe(false);
  });

  it("ignores an empty change set", () => {
    expect(readSyncChange({}, "sync").touchedSnippetKeys).toBe(0);
  });

  it("counts a gained snippet", () => {
    const reading = readSyncChange({ "snip:a": gained("a") }, "sync");

    expect(reading.touchedSnippetKeys).toBe(1);
    expect(reading.gainedOrChanged).toBe(true);
    expect(reading.removedKeys).toBe(0);
    expect(reading.likelySignOut).toBe(false);
  });

  it("counts a modified snippet", () => {
    // A rewrite carries both halves. It is a gain for the purposes of the cache
    // refresh — the content script's copy is now stale — and must not be
    // mistaken for a removal.
    const reading = readSyncChange(
      {
        "snip:a": {
          oldValue: { id: "a", label: "old" },
          newValue: { id: "a", label: "new" },
        },
      },
      "sync"
    );

    expect(reading.gainedOrChanged).toBe(true);
    expect(reading.removedKeys).toBe(0);
  });

  it("counts a removed snippet", () => {
    const reading = readSyncChange({ "snip:a": removed("a") }, "sync");

    expect(reading.removedKeys).toBe(1);
    expect(reading.gainedOrChanged).toBe(false);
    // One removal is a user deleting a snippet, not a sign-out.
    expect(reading.likelySignOut).toBe(false);
  });

  it("calls a multi-key removal a sign-out", () => {
    const reading = readSyncChange(
      {
        "snip:a": removed("a"),
        "snip:b": removed("b"),
        "snip:c": removed("c"),
      },
      "sync"
    );

    expect(reading.removedKeys).toBe(3);
    expect(reading.likelySignOut).toBe(true);
  });

  it("treats the threshold as the lowest count that counts", () => {
    // The boundary, asserted at both sides of it rather than by reading the
    // constant. The constant is also checked so a change to it is a deliberate
    // edit rather than a drift.
    expect(SIGN_OUT_KEY_THRESHOLD).toBe(2);

    const one = readSyncChange({ "snip:a": removed("a") }, "sync");
    expect(one.likelySignOut).toBe(false);

    const two = readSyncChange(
      { "snip:a": removed("a"), "snip:b": removed("b") },
      "sync"
    );
    expect(two.likelySignOut).toBe(true);
  });

  it("does not call a sign-out when snippets were also gained", () => {
    // A behaviour change, so it is stated rather than assumed.
    //
    // A real sign-out wipes `storage.sync` and gains nothing. So a change set that
    // both adds snippets and removes several is a sync from another device that
    // happened to delete a few on the way — Chrome's merge propagates deletions.
    //
    // The previous code tested the removal count alone, so this case filed a
    // "Sync storage wipe detected" report, set the sign-out flag, and on the next
    // popup open offered the user a recovery banner for snippets they never lost.
    const reading = readSyncChange(
      {
        "snip:a": gained("a"),
        "snip:b": gained("b"),
        "snip:old1": removed("old1"),
        "snip:old2": removed("old2"),
      },
      "sync"
    );

    expect(reading.removedKeys).toBe(2);
    expect(reading.gainedOrChanged).toBe(true);
    expect(reading.likelySignOut).toBe(false);
  });

  it("still calls a pure removal a sign-out", () => {
    // The guard above must not swallow the case it was added for.
    const reading = readSyncChange(
      { "snip:a": removed("a"), "snip:b": removed("b") },
      "sync"
    );

    expect(reading.gainedOrChanged).toBe(false);
    expect(reading.likelySignOut).toBe(true);
  });

  it("does not count a change with both halves set as a removal", () => {
    // The harness bug's shape, reached from the consumer side. A removal
    // misreported as a rewrite must not drive the sign-out detector, and a
    // rewrite must not be counted twice.
    const reading = readSyncChange(
      {
        "snip:a": { oldValue: { id: "a" }, newValue: { id: "a" } },
        "snip:b": { oldValue: { id: "b" }, newValue: { id: "b" } },
      },
      "sync"
    );

    expect(reading.removedKeys).toBe(0);
    expect(reading.likelySignOut).toBe(false);
    expect(reading.gainedOrChanged).toBe(true);
  });

  it("ignores a change carrying neither half", () => {
    // Chrome does not emit this, but if it did it must not be read as a gain:
    // there is no new value for the content script to cache.
    const reading = readSyncChange({ "snip:a": {} }, "sync");

    expect(reading.touchedSnippetKeys).toBe(1);
    expect(reading.gainedOrChanged).toBe(false);
    expect(reading.removedKeys).toBe(0);
  });

  it("ignores non-snippet keys when deciding a sign-out", () => {
    // Only snippets are Clipio's data. Wiping a user's other sync settings is the
    // browser's business, and raising a recovery banner for it would offer to
    // restore something that was never ours.
    const reading = readSyncChange(
      {
        themeMode: removed("dark"),
        uiFont: removed("inter"),
        onboardingCompleted: removed("true"),
      },
      "sync"
    );

    expect(reading.likelySignOut).toBe(false);
  });
});

describe("needsCacheRefresh", () => {
  it("is true when a snippet was gained or changed", () => {
    // The reason this listener exists at all: when the browser populates
    // storage.sync on its own — a Google sign-in, or a sync from another device —
    // no extension code runs, the content script's cache is never written, and
    // the user sees their snippets in the popup and finds none of them insert.
    expect(
      needsCacheRefresh(readSyncChange({ "snip:a": gained("a") }, "sync"))
    ).toBe(true);
  });

  it("is false for a pure removal", () => {
    // The cache still holds the deleted snippet, but a deletion is not the
    // "snippets exist but do not insert" failure this refresh exists to fix, and
    // a stale entry for a deleted snippet is reconciled by the popup.
    expect(
      needsCacheRefresh(readSyncChange({ "snip:a": removed("a") }, "sync"))
    ).toBe(false);
  });

  it("is false for an unrelated key", () => {
    expect(
      needsCacheRefresh(
        readSyncChange({ themeMode: { newValue: "dark" } }, "sync")
      )
    ).toBe(false);
  });
});

describe("isExternalLocalSnippetChange", () => {
  it("ignores the popup's own queue commit", () => {
    expect(
      isExternalLocalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "writer-1" } } },
        "local",
        "writer-1"
      )
    ).toBe(false);
  });

  it("detects a snippet written by another context", () => {
    expect(
      isExternalLocalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "options" } } },
        "local",
        "writer-1"
      )
    ).toBe(true);
  });

  it("uses the old value for a deletion", () => {
    expect(
      isExternalLocalSnippetChange(
        { "snip:a": { oldValue: { id: "a", updatedBy: "options" } } },
        "local",
        "writer-1"
      )
    ).toBe(true);
  });

  it("ignores draft, queue and writer-id keys", () => {
    expect(
      isExternalLocalSnippetChange(
        {
          editorDrafts: { newValue: { a: {} } },
          writeQueue: { newValue: { operations: [], sentAt: [] } },
          writerId: { newValue: "writer-2" },
        },
        "local",
        "writer-1"
      )
    ).toBe(false);
  });

  it("ignores the sync area", () => {
    expect(
      isExternalLocalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "options" } } },
        "sync",
        "writer-1"
      )
    ).toBe(false);
  });
});

describe("isExternalSnippetChange", () => {
  it("treats a sync echo of our own autosave as internal", () => {
    // Sync writes are echoed back on `onChanged`. Refreshing from that echo
    // cleared draft previews and made the sidebar flash between the text being
    // typed and the last committed version.
    expect(
      isExternalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "writer-1" } } },
        "sync",
        "writer-1"
      )
    ).toBe(false);
  });

  it("detects a genuine change from another device", () => {
    expect(
      isExternalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "other-device" } } },
        "sync",
        "writer-1"
      )
    ).toBe(true);
  });

  it("still treats a local self-write as internal", () => {
    expect(
      isExternalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "writer-1" } } },
        "local",
        "writer-1"
      )
    ).toBe(false);
  });

  it("ignores areas that never carry snippets", () => {
    expect(
      isExternalSnippetChange(
        { "snip:a": { newValue: { id: "a", updatedBy: "other" } } },
        "session",
        "writer-1"
      )
    ).toBe(false);
  });
});
