# Architecture

How Clipio is put together. For _why_ any of this was chosen, see
[`decisions/`](./decisions/).

---

## The shape of the thing

A snippet manager. You type a shortcut like `/addr` on any page and it expands to
an address, a signature, a paragraph of text — with the clipboard, the date, or
your cursor position filled in.

Three surfaces, one service worker:

```
  ┌──────────────┐  runtime.sendMessage  ┌───────────────┐
  │ content.ts   │ ────────────────────► │ background.ts │
  │ (any page)   │ ◄──────────────────── │ service worker│
  └──────────────┘   snippet index       └───────┬───────┘
                                                  │
        ┌─────────────────────────────────────────┼──────────────┐
        │                                         │              │
   ┌────▼─────┐   ┌──────────┐            ┌───────▼──────┐ ┌─────▼──────┐
   │ popup/   │   │ options/ │            │  storage     │ │  alarms    │
   │ Dashboard│   │ settings │            │  sync / IDB  │ │  updates   │
   └──────────┘   └──────────┘            └──────────────┘ └────────────┘
```

## Entrypoints

| Path            | Role                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `content.ts`    | Runs on every page. Watches for shortcut prefixes, builds the index, expands on selection. The only entrypoint that touches page DOM. |
| `background.ts` | Service worker. Owns storage sync, the write queue drain, alarms, context menus and notifications. Survives no tab, so it holds nothing that belongs to a page. |
| `popup/`        | The dashboard. Lists and searches snippets.                                                                                           |
| `options/`      | Settings, import/export, diagnostics.                                                                                                 |

## Storage

Four backends behind one manager (`src/storage/manager.ts`):

| Backend        | Holds                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `sync.ts`      | Snippets and settings. Cross-device. Hard quota — see [0004](./decisions/0004-refuse-sync-writes-over-quota.md) |
| `local.ts`     | Explicit fallback when sync is unavailable                                                                      |
| `indexeddb.ts` | Media blobs, a shadow backup of snippets, and local-only version history (schema v4)                            |
| `media.ts`     | Blobs only. Content-hashed, so the same image pasted twice is one record.                                       |

37 typed items in `src/storage/items.ts`. Every one has a default and a validator —
an untrusted import payload runs the same validator as a fresh write.

**The content script keeps a cache and is not a writer.** It receives an index from
the background and re-reads on change. Several contexts writing the same key was
the source of real clobbering bugs.

### Writes, queue and recovery

The popup can disappear on blur (ADR [0011](./decisions/0011-router-in-the-popup-is-replace-only.md)),
so the editor never writes authoritative storage itself. It stages fields in
`local:editorDrafts`; the popup store enqueues changes in `local:writeQueue`, and
the background worker drains that queue with rate limits and retries.
`StorageManager.commitChange` is the one revision-aware write path: it applies the
change to the record as it exists at commit time, resolves competing writes with
last-writer-wins, and snapshots the state being replaced into the IndexedDB
`history` store. Quota remains a terminal refusal, not a retry (ADR
[0004](./decisions/0004-refuse-sync-writes-over-quota.md)).

`local:writerId` identifies this install for that resolution and lets local-mode
storage changes from our own commits be ignored. `local:undoStacks` holds only the
popup's step direction; the long-term record is version history. These four keys
and the `history` store are local-only: they are not synced, exported, backed up,
cached for the content script, or used by search and usage counts.

The detail top bar has no Save control. It shows undo/redo and a compact sync
status; sidebar, delete, copy and insert commands stay. The create form keeps its
explicit **Create** button as the way to finish and navigate, even though its
fields autosave too. The full reasoning is in ADR
[0015](./decisions/0015-autosave-and-local-version-history.md).

## Code layout

| Directory         | Holds                                | Test approach                       |
| ----------------- | ------------------------------------ | ----------------------------------- |
| `src/lib/`        | Pure logic. No DOM, no browser APIs. | Fast unit tests                     |
| `src/storage/`    | The backends, manager, queue drain and local history. | Unit tests against `fake-indexeddb` |
| `src/components/` | React. Thin — logic lives in `lib/`. | Mostly E2E                          |
| `src/pages/`      | Page composition.                    | E2E                                 |

The split is deliberate: `src/lib/` is where the logic that can break lives, so it
is where the tests are.

## Internationalisation

Locales in `src/locales/*.yml`. The `#i18n` module is generated by `wxt prepare`
and is **not resolvable in tests** — it is aliased in `vitest.config.ts` to a stub
that resolves real keys against the real `en.yml`, so tests assert on real
user-visible copy.

Two gates keep it honest: `pnpm check:locales` (every key is read somewhere) and
`pnpm check:hardcoded-text` (no user-visible string bypassed i18n).

## Testing strategy

Three layers, and each is chosen for what it can actually prove.

| Layer                | Runs | Proves                                                                                     |
| -------------------- | ---- | ------------------------------------------------------------------------------------------ |
| **Unit** — Vitest    | ~7s  | Logic in `lib/` and `storage/`. Fast enough to run constantly.                             |
| **E2E** — Playwright | ~56s | The real extension in a real browser: injection, `storage.sync`, service-worker lifecycle. |
| **Coverage**         | —    | 80% across all code. A ratchet, not a target — see `AGENTS.md`.                            |

**E2E is deliberately small.** Only things that cannot be proven any other way:
that the content script is actually injected, that `storage.sync` behaves under a
real extension origin, that data survives a restart, and that messages cross
genuinely separate JS contexts. Everything else is a unit test — faster, cheaper,
and they fail more precisely. The rule and the 153 → 31 classification behind it
are in [0006](./decisions/0006-e2e-only-what-needs-a-browser.md).

**There are no spec files.** A test that can fail is the specification; prose
describing behaviour a test already pins is a second copy that drifts. Reasoning
that cannot be recovered from a test — a rejected alternative, a non-functional
invariant — goes to [`decisions/`](./decisions/) instead. See
[0007](./decisions/0007-tests-are-the-specification.md).
