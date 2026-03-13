# Module: Developers Section (Options Page)

> Source: `src/pages/OptionsPage.tsx` — `DevelopersSection` component
> Coverage target: N/A (UI component, covered by e2e tests)

## Purpose

The Developers section of the Options page provides power-user diagnostic and
debug tools. It is intentionally not beginner-facing — cards are clearly
labelled as advanced or diagnostic. The section is accessible via the
"Developers" nav item in the options sidebar.

## Scope

**In scope (7 cards):**

1. **Giphy API Key** — already exists; override the bundled key.
2. **Extension Version & Update** — show current version; link to release page if update available.
3. **Content Script Health** — ping the active tab's content script; display pong or error.
4. **Storage Mode** — show current backend (sync/local) and quota breakdown.
5. **Top 5 Usage** — show top 5 most-used snippets by count (cross-referenced by label).
6. **Clear IDB Backup** — one-click wipe of the IndexedDB backup store (with confirmation).
7. **Dev-only Sentry Test** — existing card; kept dev-only.

**Out of scope:**

- Actual snippet deletion or editing.
- Changing storage mode manually.
- The background alarm schedule.

---

## Card Specs

### Card 1: Giphy API Key (existing)

Already implemented. No changes required.

---

### Card 2: Extension Version & Update

**Description:** Shows the current installed version. If an update is available
(and not dismissed), shows a link to the GitHub release.

**Behavior:**

- MUST display the version string from `browser.runtime.getManifest().version`
- MUST read `latestVersionItem` from storage on mount
- WHEN an update is available AND not dismissed: MUST show a "New version available: X.Y.Z" message with a button that opens `htmlUrl` in a new tab
- Clicking the button MUST call `browser.tabs.create({ url: htmlUrl })`

---

### Card 3: Content Script Health

**Description:** Sends a `clipio-ping` message to the active tab's content script and
shows the response.

**Behavior:**

- MUST have a "Ping content script" button
- On click: MUST query `browser.tabs.query({ active: true, currentWindow: true })`
  and send `{ type: "clipio-ping" }` to the first matching tab
- MUST display "Pong" on successful response (`{ pong: true }`)
- MUST display an error message when no content script is found or send fails
- MUST show a loading indicator while the ping is in-flight

---

### Card 4: Storage Mode & Quota

**Description:** Shows the current active storage backend and a breakdown of
estimated storage usage.

**Behavior:**

- MUST read `getStorageStatus()` on mount
- MUST display "sync" or "local" as the active mode
- MUST show total estimated sync bytes used vs. the 102,400 byte limit
- Quota estimation MUST use `new Blob([JSON.stringify(k) + JSON.stringify(v)]).size`
  for each sync key (fast path — no per-key `getBytesInUse` calls)

---

### Card 5: Top 5 Usage

**Description:** Lists the five most-used snippets by insertion count.

**Behavior:**

- MUST read `usageCountsItem` on mount
- MUST cross-reference snippet IDs with `getSnippets()` to show labels
- MUST display entries sorted descending by count
- MUST show at most 5 entries
- MUST show "No usage data yet." when counts are empty

---

### Card 6: Clear IDB Backup

**Description:** Wipes the IndexedDB `snippets` store backup.

**Behavior:**

- MUST require a two-step confirmation: first click shows a confirm button;
  second click performs the wipe and resets to the initial state
- MUST call `clearIDBBackup()` on confirmation
- MUST show a success flash ("Cleared") for 2 seconds after completion
- MUST use the same confirmation flash pattern (boolean state + setTimeout 2000ms)

---

## i18n

All user-visible strings MUST be added to `src/locales/en.yml` under
`options.developers.*` and mirrored in `src/locales/es.yml`.

## Error Handling

- Storage reads that fail are silently swallowed (show "--" or "N/A").
- Ping failures show a user-readable error string (not a raw exception).

## Dependencies

- `latestVersionItem` — `src/storage/items.ts`
- `usageCountsItem` — `src/storage/items.ts`
- `getStorageStatus()` — `src/storage/index.ts`
- `getSnippets()` — `src/storage/index.ts`
- `clearIDBBackup()` — `src/storage/index.ts`
- `browser.runtime.getManifest()` — for version string
- `browser.tabs.query()` / `browser.tabs.sendMessage()` — for ping
- `browser.tabs.create()` — for opening release URL
- `CONTENT_SCRIPT_PING_MESSAGE_TYPE` — `src/config/constants.ts`

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-13 | Initial spec | —      |
