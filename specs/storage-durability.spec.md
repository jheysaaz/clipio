# Spec: Storage Durability

> Source: `src/storage/types.ts`, `src/storage/backends/sync.ts`, `src/storage/backends/local.ts`, `src/storage/backends/indexeddb.ts`, `src/storage/manager.ts`
> Tests: `src/storage/backends/sync.test.ts`, `src/storage/manager.test.ts`, `e2e/storage.spec.ts`
> Status: in progress

## Purpose

Three independent paths can destroy a user's snippets. Each is a _silent_ failure: the write
reports success, and the data is gone. This spec closes all three.

---

## Problem 1 — The `remove()` / `set()` tear

`SyncBackend.saveSnippets` performed two separate awaited calls:

```ts
await browser.storage.sync.remove(toRemove); // deletions land
// ... process dies, or the MV3 worker is evicted after ~30s idle ...
await browser.storage.sync.set(toSet); // additions never happen
```

`browser.storage.sync` offers no transaction across calls. An MV3 service worker is evicted
aggressively on an idle browser, so a user with a few hundred snippets in sync mode is one
unlucky tab close away from losing most of their library — **from both the primary store and
the IndexedDB backup**, since the backup is written after the primary.

The ordering made it worse: deletions were applied first, so the interrupted state is
"snippets missing", which is indistinguishable from the user having deleted them.

## Problem 2 — Corruption is silently promoted to deletion

`getSnippets` caught a per-key `JSON.parse` failure, logged it, and moved on:

```ts
} catch {
  console.error("[Clipio] SyncBackend: failed to parse snippet at key", key);
}
```

The snippet is absent from the returned list. On the **very next** write, `saveSnippets`
derives its removals as "every `snip:` key not present in the incoming list" — and the
unparseable key is not in that list, because it was skipped. So the next save **permanently
deletes the record**. A transient corruption becomes data loss, with no user-visible signal.

## Problem 3 — Concurrent contexts delete each other's snippets

`saveSnippet`, `updateSnippet` and `deleteSnippet` all do a whole-array read-modify-write
through `persistSnippets`:

```ts
const snippets = await this.getSnippets(); // read
const next = snippets.filter((s) => s.id !== id);
await this.persistSnippets(next); // write
```

`browser.storage.sync` is a single shared store, and the popup and the options page are
separate JavaScript contexts each holding their own `StorageManager`. If the popup reads,
the options page saves `A'`, and then the popup deletes `B`, the popup's stale array does
not contain `A'` — so `persistSnippets` writes a list missing `A'` and **silently reverts
the options-page save**, while the UI reported "Saved". The mirror-image case is worse: the
popup's stale read means a snippet the options page just _created_ is absent from
`toRemove`'s inverse and gets deleted.

`manager.test.ts` exercises every CRUD method, always in isolation, so this is invisible to
the suite.

---

## Solution

### 1. Reorder, then journal

**Reorder** (the cheap, always-on half): upsert **before** remove. An interrupted write now
leaves extra snippets rather than missing ones — visible to the user, and self-healing on
the next write. This alone removes the catastrophic failure mode.

**Journal** (exactness): record the intent under a `_pendingWrite` key before applying it,
and replay it on the next read. The protocol is:

1. `set({ _pendingWrite: { toSet, toRemove, at } })`
2. `set(toSet)`
3. `remove(toRemove)`
4. `remove([_pendingWrite])`

`getSnippets` replays steps 2–4 when it finds `_pendingWrite`. All three are idempotent, so
replay is safe. The journal is only complete because it records **both** halves: replaying a
removal without knowing the upsert landed is exactly the catastrophe above.

`_pendingWrite` does not begin with `snip:`, so it is never mistaken for a snippet and is
never caught by the removal derivation.

**Quota caveat, handled explicitly.** The journal transiently doubles the storage needed by
the pending set. Sync is capped at 100 KB, so for a bulk import of hundreds of snippets the
journal could push an otherwise-valid write over the limit and raise a _false_ quota error.
The journal is therefore written only when the pending payload is small
(`JOURNAL_MAX_BYTES`); larger writes rely on the reorder alone. Their failure mode is
"some new snippets missing", which the user can fix by re-running the import they just
performed — a far better outcome than a spurious switch to local storage.

### 2. Quarantine, never delete

A key that fails to parse is moved to `corrupt:snip:<id>` with its raw value preserved, and
the original key removed. `corrupt:` does not start with `snip:`, so the quarantine is
invisible to the read loop and can never be swept up by a removal derivation. The user's data
survives in a form that can be inspected and restored.

`listCorruptKeys()` is exposed for diagnostics.

### 3. Intent-based mutations

The whole-array read-modify-write is the root of problem 3, so it goes. `StorageBackend`
gains two intent-shaped operations:

- `upsertSnippets(snippets)` — write exactly these keys, delete nothing
- `removeSnippetsById(ids)` — remove exactly these keys

and the manager's CRUD expresses intent instead of computing a full replacement list:

| Operation       | Before                      | After                       |
| --------------- | --------------------------- | --------------------------- |
| `saveSnippet`   | read all, append, write all | `upsertSnippets([snippet])` |
| `updateSnippet` | read all, map, write all    | `upsertSnippets([updated])` |
| `deleteSnippet` | read all, filter, write all | `removeSnippetsById([id])`  |

A delete now removes one named key instead of "everything I happened to see", so a
concurrent add in another context is no longer swept away. `saveSnippets` (replace
everything) is retained for the cases that genuinely mean it: import, mode switch, clear.

This is a deliberate change to the `StorageBackend` interface. Its previous
`saveSnippets(fullList)` shape _is_ the bug — "delete everything I did not see" cannot be
made safe while it remains the only way to express a deletion.

## Acceptance Criteria

### Tear

- [x] A pending write is recorded before any key is removed.
- [x] Upserts are applied before removals.
- [x] An interrupted write is completed on the next read.
- [x] Replay is idempotent — running it twice changes nothing.
- [x] The journal key is not treated as a snippet.
- [x] A large bulk write that would breach quota still succeeds (journal skipped).
- [x] No journal is written when there is nothing to change.
- [x] A no-op save performs no writes at all.

### Quarantine

- [x] An unparseable `snip:` key is preserved under a `corrupt:` key.
- [x] The unparseable key is removed from the `snip:` namespace.
- [x] A later save does **not** delete a quarantined record.
- [x] `listCorruptKeys()` reports the quarantined keys.
- [x] A corrupt record does not appear in `getSnippets()`.
- [x] A corrupt record is never resurrected as a snippet by a later save.

### Concurrency

- [x] `deleteSnippet` removes only the named id, not everything absent from a stale read.
- [x] A snippet created by another context after our read survives our delete.
- [x] A snippet updated by another context after our read is not reverted by our write.
- [x] `saveSnippet` does not read the whole store.
- [x] `bulkSaveSnippets` still replaces the full set (import semantics preserved).

## Edge Cases

- **A corrupt record that is actually recoverable** (e.g. truncated JSON) stays quarantined
  rather than being repaired. Repairing it is a future concern; preserving it is the
  requirement here.
- **The quarantine key is counted against the 100 KB sync quota.** It is a few hundred bytes
  per corrupt record and only exists while there is corruption, so this is acceptable, but it
  is a real cost and is why the quota logic must tolerate a `StorageQuotaError` from the
  quarantine write itself. That write is best-effort: if it fails, the original key is left
  in place, which is the old behaviour and no worse.
- **A replay that throws** (e.g. the journal is itself corrupt) must not break the read. The
  read falls through to the normal path and reports the failure.
- **`_pendingWrite` left over from a much older version** is ignored if it does not parse,
  and is not treated as a snippet in either case.
- **Journal replay ordering matters:** upserts must be replayed before removals, or a replay
  could delete a snippet whose replacement was never written. The replay uses the same order
  as the live write for this reason.

## Non-Goals

- A cross-context lock. `browser.storage` offers no primitive for one, and a lock held in
  one context cannot be made reliable against another's eviction. Intent-based mutations
  remove the _harm_ instead of preventing the race.
- True multi-device conflict resolution. That is what the 100 KB sync store fundamentally
  does not provide; it is addressed in the deferred storage rewrite.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
