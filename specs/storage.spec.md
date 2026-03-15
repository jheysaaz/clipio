# Module: Storage Layer

> Source: `src/storage/`
> Coverage target: 80%

## Purpose

Manages persistent storage of snippets across three backends with automatic
fallback and cross-context synchronization:

1. **`SyncBackend`** (`browser.storage.sync`) — primary, syncs across devices
2. **`LocalBackend`** (`browser.storage.local`) — fallback when sync quota exceeded
3. **`IndexedDBBackend`** (`browser.storage.local` via IndexedDB) — shadow backup

`StorageManager` orchestrates all three backends and exposes a single CRUD API
to the rest of the application.

## Scope

**In scope:** Backend implementations, manager orchestration, quota handling,
migration from legacy format, content-script cache updates.
**Out of scope:** UI banners, storage item type definitions, WXT storage API
internals.

---

## `StorageQuotaError`

> Source: `src/storage/types.ts`

**Behavior:**

- MUST extend `Error`.
- MUST have `name === "StorageQuotaError"`.
- MUST have a default message of `"browser.storage.sync quota exceeded"`.
- MUST accept a custom message via constructor parameter.

---

## `SyncBackend`

> Source: `src/storage/backends/sync.ts`

### `SyncBackend.getSnippets(): Promise<Snippet[]>`

**Behavior:**

- MUST call `browser.storage.sync.get(null)` to retrieve all keys.
- MUST detect the legacy single `"snippets"` key and migrate it:
  - Parse the value (JSON string or object array).
  - Save to per-key layout via `saveSnippets`.
  - Remove the `"snippets"` key.
  - Return the migrated snippets.
- MUST read all keys with prefix `"snip:"` and parse each as a `Snippet`.
- MUST skip and log keys with unparseable values (not throw).
- MUST return an empty array when no `"snip:"` keys exist.

### `SyncBackend.saveSnippets(snippets: Snippet[]): Promise<void>`

**Behavior:**

- MUST get current state to determine keys to remove.
- MUST remove any `"snip:"` keys not present in the new snippets array.
- MUST upsert each snippet under key `"snip:<id>"`.
- MUST skip writing snippets whose serialized value is already identical to storage (no-op optimization).
- MUST throw `StorageQuotaError` when `browser.storage.sync.set` throws an error
  containing `"QUOTA_BYTES"`, `"MAX_ITEMS"`, or `"quota"` in the message.
- MUST re-throw other errors unchanged.

### `SyncBackend.clear(): Promise<void>`

- MUST remove all `"snip:"` keys from `browser.storage.sync`.

---

## `LocalBackend`

> Source: `src/storage/backends/local.ts`

### `LocalBackend.getSnippets(): Promise<Snippet[]>`

- MUST return the value of `localSnippetsItem` (defaults to `[]`).

### `LocalBackend.saveSnippets(snippets: Snippet[]): Promise<void>`

- MUST set `localSnippetsItem` to the provided array.

### `LocalBackend.clear(): Promise<void>`

- MUST call `localSnippetsItem.removeValue()`.

### `updateContentScriptCache(snippets: Snippet[]): Promise<void>`

- MUST set `cachedSnippetsItem` to the provided array.
- MUST NOT throw — catches and logs errors (uses `captureError` for Sentry).

---

## `StorageManager`

> Source: `src/storage/manager.ts`

### `StorageManager.getSnippets(): Promise<Snippet[]>`

**Behavior:**

- MUST read `storageModeItem` to determine the active backend.
- MUST read from `LocalBackend` when mode is `"local"`.
- MUST read from `SyncBackend` when mode is `"sync"`.
- MUST catch `StorageQuotaError` from `SyncBackend`, switch mode to `"local"`,
  and fall back to `LocalBackend`.
- MUST re-throw non-quota errors from `SyncBackend`.

### `StorageManager.saveSnippet(snippet: Snippet): Promise<void>`

- MUST read current snippets, append the new snippet, and call `persistSnippets`.

### `StorageManager.updateSnippet(updated: Snippet): Promise<void>`

- MUST read current snippets, replace the matching `id` with `updated`, and call `persistSnippets`.

### `StorageManager.deleteSnippet(id: string): Promise<void>`

- MUST read current snippets, filter out the given `id`, and call `persistSnippets`.

### `StorageManager.bulkSaveSnippets(snippets: Snippet[]): Promise<void>`

- MUST call `persistSnippets` with the provided array directly.

### `persistSnippets` (internal)

**Behavior:**

- MUST save to `LocalBackend` when mode is `"local"`.
- MUST save to `SyncBackend` when mode is `"sync"`.
- MUST catch `StorageQuotaError` from `SyncBackend`, switch mode to `"local"`,
  save to `LocalBackend`, and re-throw `StorageQuotaError` to callers.
- MUST always call `updateContentScriptCache` after every successful save.
- MUST always call `IndexedDBBackend.saveSnippets` as a fire-and-forget shadow write
  (failures MUST NOT propagate to callers).

### `StorageManager.getStorageStatus(): Promise<StorageStatus>`

- MUST return `{ mode, quotaExceeded, localReason }` where:
  - `mode` is the current `storageModeItem` value (`"sync"` or `"local"`).
  - `quotaExceeded` is `true` only when `mode === "local"` AND
    `localReason === "quota"` (auto-fallback from quota overflow).
  - `localReason` is `"quota"` (auto-fallback) or `"manual"` (user force-switch).

### `StorageManager.forceSetMode(mode: StorageMode): Promise<void>`

- MUST be a no-op when `mode` equals the current mode.
- MUST read all snippets from the currently active backend.
- MUST write them to the target backend (data migration).
- MUST update `storageModeItem` to the new mode.
- MUST set `storageModeReasonItem` to `"manual"`.
- MUST refresh the content-script cache via `updateContentScriptCache`.
- MUST shadow-write to IndexedDB backup (fire-and-forget).

### `StorageManager.tryRecoverFromBackup(): Promise<Snippet[]>`

- MUST delegate to `IndexedDBBackend.getSnippets()`.
- MUST NOT modify any storage — recovery is read-only.

### `StorageManager.clearSyncDataLostFlag(): Promise<void>`

- MUST call `syncDataLostItem.removeValue()`.

### `StorageManager.clearIDBBackup(): Promise<void>`

- MUST delegate to `IndexedDBBackend.clear()`.
- Used by the Developers section to wipe the IDB backup without affecting
  primary sync/local storage.

---

## Error Handling

- Storage operations MUST propagate errors to callers (except `updateContentScriptCache`
  and IndexedDB shadow writes which are fire-and-forget).
- `StorageQuotaError` triggers an automatic mode switch; callers can catch it
  to display a quota warning to the user.

## Dependencies

All backends depend on browser APIs:

- `SyncBackend` → `browser.storage.sync`
- `LocalBackend` → WXT `storage.defineItem` (wraps `browser.storage.local`)
- `IndexedDBBackend` → `indexedDB` global
- `storageModeItem` — `src/storage/items.ts`
- `storageModeReasonItem` — `src/storage/items.ts`
- `syncDataLostItem` — `src/storage/items.ts`

The following developer/diagnostic storage items have behavioral contracts
documented in `specs/developers-section.spec.md`:
`typingTimeoutItem`, `debugModeItem`, `debugLogItem`.

In tests, all browser APIs must be mocked. See `tests/mocks/browser.ts`.

## Change History

| Date       | Change                                                   | Author |
| ---------- | -------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                             | —      |
| 2026-03-14 | Add forceSetMode, clearIDBBackup, storageModeReasonItem; | —      |
|            | fix getStorageStatus return shape                        |        |
