# Spec: Content-Script Cache Coherence

> Source: `src/entrypoints/background.ts`, `src/storage/backends/local.ts`, `src/storage/index.ts`, `src/entrypoints/content.ts`
> Tests: `e2e/cache-coherence.spec.ts`
> Status: implemented

## Purpose

The content script and the popup do not read the same store. Making sure they agree is the
difference between a snippet that works and one that is listed but does nothing.

## Problem

The popup reads `browser.storage.sync` directly, through `StorageManager.getSnippets()`.

The content script reads **only** `local:cachedSnippets` — it cannot reach `storage.sync`
at all from its isolated world, which is why the mirror exists.

The mirror had exactly one writer:

```
manager.persistSnippets()  ->  updateContentScriptCache()  ->  cachedSnippetsItem.setValue()
```

`persistSnippets` is reached only from a **user action** in the popup or the options page —
save, update, delete, import, mode switch. There was no other writer anywhere in `src/`.

So whenever the browser populates `storage.sync` on its own, no extension code runs:

- the user **signs into a Google account**, and Chrome syncs their data in;
- **another device** with the same account syncs to this one.

In both cases the popup immediately shows the snippets, because it reads the authoritative
store. The content script keeps serving whatever `local:cachedSnippets` happened to contain —
often nothing, since it is only ever written on this device.

The user-visible result: **every shortcut is listed in the popup and none of them insert.**
Reloading the page does not help, because a reload re-reads the same stale cache. This was
reported in the field as "the shortcuts recover on the popup but inserting them doesn't work,
even after reloading".

The related wipe path had the opposite problem: `background.ts` detected ≥2 `snip:` keys
vanishing (a sign-out) and raised the recovery banner, but never handled keys _appearing_.

## Solution

The background service worker is the only context that both outlives a page and can observe a
`storage.sync` change, so the refresh belongs there.

- Its existing `storage.onChanged` listener now also schedules a cache refresh when any
  `snip:` key is **added or changed** in the sync area.
- The refresh reads through the `StorageManager` rather than touching `storage.sync`
  directly, so it respects the active mode and the **read-path** quota fallback. (The
  _write_ path no longer has one — see `specs/storage-quota-preflight.spec.md`.)
- Events are **coalesced** over `TIMING.CACHE_REFRESH_DEBOUNCE_MS` (250 ms), because
  `storage.sync` fires once per key and a bulk import would otherwise trigger one full store
  read per snippet.
- A **removal-only** change does not trigger a refresh. That is the sign-out / wipe case, and
  it has its own recovery flow; blanking the cache there would interact with the banner the
  user is being offered.

The refresh is best-effort: a failure is logged and reported but never surfaces, and the
content script simply keeps whatever it had.

### The cache has exactly one writer

A read must **not** repair the cache, even when the cache is empty. This is the tempting fix
for staleness, and it is wrong:

- A read cannot know whether the cache is newer than the list it just read. If another context
  saved or deleted snippets in between, a repair overwrites that newer state with an older
  list.
- The consequence is a resurrected snippet: the content script expands something the user just
  deleted. That is more alarming, and harder to diagnose, than a briefly stale cache.
- An empty cache is **not** the safe case. `[]` is the _correct_ value immediately after the
  last snippet is deleted, so "the cache is empty, therefore it is stale" is simply false.

So `StorageManager.getSnippets()` is a pure read. `updateContentScriptCache` is the single
physical writer, and it has four call sites — `forceSetMode`, `persistSnippets`,
`refreshDerivedStores`, and the background's debounced sync refresh. All four act on a change
they observed (a mode switch, a save, a delete, a `storage.onChanged` event) rather than on a
read that raced one; `refreshDerivedStores` re-reads the store _after_ the delete, so it is a
post-change read. None of them is reachable from a plain read.

## Acceptance Criteria

- [x] A snippet that arrives in `storage.sync` alone can be inserted on a page.
- [x] A read never writes the content-script cache, so a read cannot resurrect a deleted
      snippet or roll back a concurrent save.
- [x] The popup and the content script agree after a sync-area change.
- [x] A sync that lands while a tab is open is picked up without a reload.
- [x] The cache projection itself is observably refreshed, independent of insertion.
- [x] The refresh is coalesced, so a burst of per-key events does not cause one read each.
- [x] A removal-only sync change does **not** blank the cache (wipe flow owns that case).
- [x] The refresh goes through the manager, so local mode and the read-path quota fallback still apply.
- [x] A failing refresh does not throw into the storage listener.
- [x] Normal user-driven saves still refresh the cache exactly as before.

## Edge Cases

- **The refresh runs on our own writes too.** `StorageManager` already updates the cache
  after a save, and the background refresh is idempotent, so this is redundant rather than
  harmful. It does not loop: the refresh writes to `storage.local`, and the listener only
  reacts to the `sync` area.
- **Local mode.** When the active mode is `local`, `getSnippets()` reads
  `local:snippets` rather than sync, so the refresh projects the right source.
- **A sync area change unrelated to snippets** (a setting, the update-check timestamp) is
  ignored — the listener filters on the `snip:` prefix.
- **`storage.sync` unavailable** (Firefox private browsing, quota disabled). The refresh
  goes through the manager, which already falls back to local.

## Non-Goals

- Replacing the mirror. The content script genuinely cannot read `storage.sync`, so a
  projection is required; making that projection authoritative (a content-script index
  rebuilt from IDB) belongs to the deferred storage rewrite.
- Changing the wipe/recovery flow.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
