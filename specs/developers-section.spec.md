# Module: Developers Section (Options Page)

> Source: `src/pages/OptionsPage.tsx` — `DevelopersSection` component
> Coverage target: N/A (UI component, covered by e2e tests)

## Purpose

The Developers section of the Options page provides power-user diagnostic and
debug tools. It is intentionally not beginner-facing — cards are clearly
labelled as advanced or diagnostic. The section is accessible via the
"Developers" nav item in the options sidebar.

## Scope

**In scope (10 cards):**

1. **Giphy API Key** — already exists; override the bundled key.
2. **Extension Version & Update** — show current version; link to release page if update available.
3. **Content Script Health** — ping the active tab's content script; display pong or error.
4. **Storage Mode** — show current backend (sync/local), quota breakdown, and force-switch controls.
5. **Typing Timeout** — slider to tune the snippet expansion debounce delay (50–2000 ms).
6. **Top 5 Usage** — show top 5 most-used snippets by count (label + shortcut + count).
7. **Debug Mode** — toggle verbose logging; live in-page log panel with clear button.
8. **Clear IDB Backup** — one-click wipe of the IndexedDB backup store (with confirmation).
9. **Dev-only Sentry Test** — existing card; kept dev-only.

**Out of scope:**

- Actual snippet deletion or editing.
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

**Description:** Shows the current active storage backend, a breakdown of
estimated storage usage, and buttons to force-switch the active backend.

**Behavior:**

- MUST read `getStorageStatus()` on mount
- MUST display "sync" or "local" as the active mode
- MUST show total estimated sync bytes used vs. the 102,400 byte limit
- Quota estimation MUST use `new Blob([JSON.stringify(k) + JSON.stringify(v)]).size`
  for each sync key (fast path — no per-key `getBytesInUse` calls)
- WHEN mode is "sync": MUST show a "Switch to local" button
- WHEN mode is "local": MUST show a "Switch to sync" button
- Both switch buttons MUST require a two-step confirmation (same pattern as Clear IDB)
- On confirmation: MUST call `forceSetStorageMode(target)` which migrates all snippets
  from the current backend to the target backend before changing the mode flag
- MUST show a "Switched!" flash for 2 seconds on success
- MUST show an error message if the switch fails
- `forceSetStorageMode` MUST be a no-op when already on the target mode

---

### Card 5: Typing Timeout

**Description:** A range slider to configure how long Clipio waits after the
user stops typing before attempting snippet expansion.

**Behavior:**

- MUST read `typingTimeoutItem` on mount; fall back to `TIMING.TYPING_TIMEOUT` (300 ms)
- MUST render a `<input type="range">` with min=50, max=2000, step=50
- MUST display the current value in ms next to the slider
- MUST persist the new value to `typingTimeoutItem` 400 ms after the last slider change
  (debounced — avoids hammering storage while dragging)
- MUST show a "Saved" flash for 2 seconds after successful persistence
- MUST provide a "Reset to default" button that sets the value back to 300 ms
- The content script MUST watch `typingTimeoutItem` and update its debounce delay
  without requiring a page reload

---

### Card 6: Top 5 Usage

**Description:** Lists the five most-used snippets by insertion count.

**Behavior:**

- MUST read `usageCountsItem` on mount
- MUST cross-reference snippet IDs with `getSnippets()` to show labels and shortcuts
- MUST display each entry as a bordered card showing: label, shortcut (font-mono badge), usage count
- MUST display entries sorted descending by count
- MUST show at most 5 entries
- MUST show "No usage data yet." when counts are empty

---

### Card 7: Debug Mode

**Description:** A toggle that enables verbose activity logging to the browser
console and an in-page scrollable log panel.

**Behavior:**

- MUST read `debugModeItem` on mount to initialise the toggle state
- MUST persist the new value to `debugModeItem` immediately on toggle
- WHEN enabled: MUST show a scrollable log panel (height-limited, overflow-y-auto)
- The log panel MUST watch `debugLogItem` for live updates without polling
- The log panel MUST auto-scroll to the newest entry when new entries arrive
- Each log row MUST display: timestamp (HH:MM:SS.mmm), context badge (color-coded),
  event name, detail string
- MUST provide a "Clear log" button that sets `debugLogItem` to `[]`
- MUST show "No log entries yet." when the log is empty

**`debugLog()` utility (`src/lib/debug.ts`):**

- MUST be a no-op (no storage writes, no console output) when `debugModeItem` is false
- WHEN enabled: MUST append a `DebugLogEntry` to `debugLogItem` and call `console.debug`
- The buffer MUST be capped at 100 entries (FIFO — oldest entry dropped when full)
- MUST silently ignore storage read or write failures (never throws)
- MUST support `context: "content" | "background" | "storage"` to identify the source

**Instrumented events (content script):**

- `index:rebuild` — emitted after shortcut index is rebuilt
- `expand:match` — emitted when a shortcut match is found before expansion
- `expand:no-match` — emitted when text is checked but no shortcut matches
- `expand:done` — emitted after expansion completes (includes `stuck` and `durationMs`)
- `config:typingTimeout` — emitted when the typing timeout is updated via watch

**Instrumented events (background worker):**

- `alarm:fired` — emitted when any alarm fires
- `update:check:start` — emitted when the update check alarm triggers
- `message:received` — emitted when a recognised runtime message is received

---

### Card 8: Clear IDB Backup

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
- `typingTimeoutItem` — `src/storage/items.ts`
- `debugModeItem` / `debugLogItem` / `DebugLogEntry` — `src/storage/items.ts`
- `getStorageStatus()` — `src/storage/index.ts`
- `forceSetStorageMode()` — `src/storage/index.ts`
- `getSnippets()` — `src/storage/index.ts`
- `clearIDBBackup()` — `src/storage/index.ts`
- `debugLog()` — `src/lib/debug.ts`
- `TIMING.TYPING_TIMEOUT` — `src/config/constants.ts`
- `browser.runtime.getManifest()` — for version string
- `browser.tabs.query()` / `browser.tabs.sendMessage()` — for ping
- `browser.tabs.create()` — for opening release URL
- `CONTENT_SCRIPT_PING_MESSAGE_TYPE` — `src/config/constants.ts`

## Change History

| Date       | Change                                                            | Author |
| ---------- | ----------------------------------------------------------------- | ------ |
| 2026-03-13 | Initial spec                                                      | —      |
| 2026-03-14 | Add Storage Mode force-switch, Typing Timeout slider, Debug Mode, | —      |
|            | Top 5 shortcut display; update scope and dependencies             |        |
