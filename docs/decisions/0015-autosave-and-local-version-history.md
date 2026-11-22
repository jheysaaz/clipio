# 0015 — Autosave through a background-owned queue, with local version history

**Status:** accepted · **Date:** 2026-11-22

## Context

The detail editor saved only when the user pressed **Save**. The popup dies on
blur (ADR [0011](0011-router-in-the-popup-is-replace-only.md)), so a keystroke,
a tab switch or an accidental click outside the popup could discard the edit.
Adding a debounce inside the popup would not fix that: the document can disappear
before the timer fires, and even a fired timer was doing an unrevisioned
read-modify-write that could clobber a change from Options, the background or
another device.

The existing record had no write revision and no writer identity. Two contexts
could each read the same snippet and write their own whole copy back; the later
write won without knowing that it had overwritten something. Quota refusals were
already a settled question — ADR [0004](0004-refuse-sync-writes-over-quota.md)
says refuse loudly, never silently fall back — but a queue makes it possible to
retry an ordinary rejection forever unless refusals are classified first.

Users also need to get back a previous body. That is different from "what did I
just undo?": a long-lived record answers the first, while the popup's undo cursor
answers the second. Conflating them would make redo guess from a chronological
list whose newest entry is not necessarily the state the user just stepped away
from.

## Decision

### The popup stages; the background owns the queue

The popup's job is to stage editor fields in `local:editorDrafts` and enqueue a
change in `local:writeQueue`. Draining happens only in the background worker,
started from `background.ts`, because that context survives the popup closing.

One queued operation per snippet is kept. Further edits coalesce into it, keeping
the latest fields and the oldest `baseRev` so the commit still knows what the
burst was based on. The drain serialises itself, observes a 2-second minimum gap
and budgets of 20 writes/minute and 600/hour, and retries transient rejections
with exponential backoff and 25% jitter up to 6 attempts. An attempt is recorded
before the write, so a worker restart cannot grant an extra slot.

Outcomes are classified, not all treated as "try again":

- **Quota** is a terminal refusal for that operation (ADR 0004). The draft stays
  local, the status shows `refused`, and nothing is retried, chunked or diverted.
  A later successful edit for the same snippet clears the stale refusal.
- **Stale conflict** is terminal `failed`. Retrying would keep writing an old
  edit over newer data. The draft stays put for the user to resolve or discard.
- **Anything else** is transient and gets a backoff until attempts run out.

The create form uses the same path with one provisional id for the whole form
session. Its fields autosave, but `snippet-create-save` remains the explicit way
to finish validation, address the new record and navigate to it. Inline rename,
delete and undo-delete also go through the queue, so there is one write path for
every editor-originated change.

### One revisioned commit path decides who wins

`Snippet.rev` and `Snippet.updatedBy` are new optional fields; legacy records
normalise to revision 0 and writer `"unknown"`. `local:writerId` is a local-only
install id used as the final tie-break, never backed up or synced.

`StorageManager.commitChange` applies fields to the record as it exists *at
commit time*, preserving usage and creation fields the editor never owns, and
writes `rev + 1` with the queue's timestamp and writer. Competing records are
ordered by timestamp, then revision, then writer id; every tie-break is
deterministic. An edit or delete made from an older revision returns a conflict
instead of overwriting the stored record. Restore and import are exempt: the
user explicitly chose that older state. Direct save/update/delete calls still
exist for non-queue paths, but they do not claim revision awareness.

### History is local, separate and bounded

IndexedDB schema v4 adds a `history` store beside the shadow backup and media
stores. A snapshot is written *before* a stored record is replaced, with a
reason of `edit`, `delete`, `restore`, `import` or `conflict`. A losing queued
edit is snapshotted as `conflict`, so the effort is recoverable even though the
write was refused.

Snapshots in the same 30-second burst with the same reason coalesce, keeping the
first: a user typing for half a minute wants the state before the burst, not one
entry per keystroke. Caps are 20 versions per snippet, 500 versions globally and
a 10 MB byte estimate. Trimming is oldest-first, but the newest snapshot of every
snippet is preserved so a snippet always has at least one way back.

History never enters sync, export, import, backup, search, usage counts or the
content-script cache. It is this install's recovery record, not portable data.

### Undo is a cursor, not the history list

`local:undoStacks` keeps up to 50 editor-field states per snippet, with past and
future cursors. Fields, not whole snippets, are stored so an undo cannot revive a
stale `rev`, `usageCount` or `createdAt`. Undo and redo enqueue a `restore` change
through the same queue and are exempt from the stale check. Editing again after
an undo drops the redo branch.

Undo discards only an *unflushed* draft; it must not clear the committed undo
history it is about to step through. Cancel and undo-delete call the stronger
`discardDraft`, which clears the draft, the refusal and the undo state.

### The top bar reflects the new contract

The detail top bar's Save button is gone. In its place are small undo/redo
controls and a compact `role="status"` indicator showing pending, failed,
refused or saved. Sidebar toggle, delete, copy and insert commands stay. The
status is queue-wide rather than per-snippet: it answers "are my writes landing?",
not "which record changed?".

### Local storage changes from ourselves are not external edits

In local mode, our own commits fire `storage.onChanged` in the popup too. The
snippet store now compares `updatedBy` with `local:writerId` for `snip:` changes
in the `local` area and ignores self-writes; changes from other contexts carry a
different writer id and still refresh the list. Draft, queue, undo and writer-id
keys have no `snip:` prefix, so they are excluded by the key check rather than by
a denylist that would grow with every new local key.

## Alternatives considered

- **Debounce a save inside the popup.** It still dies on blur, and it keeps the
  unrevisioned write that caused cross-context clobbering.
- **Put the queue in the popup and copy it to local storage.** That is two owners
  of one queue. The background already survives the popup; it should own it.
- **Read-modify-write against the store at flush time.** The read can be stale by
  the time the write lands. Committing against the current record with an
  explicit base revision makes the conflict visible instead of silent.
- **Retry quota failures with backoff or a local fallback.** ADR 0004 rejects
  both: the user must be told, and a retry would burn slots on an answer we
  already have.
- **Use version history as the undo stack.** A chronologically newest snapshot is
  not necessarily the redo target. Cursors and history answer different
  questions.
- **Sync history with snippets.** It would consume the hard `storage.sync` quota
  and turn a local recovery aid into portable data nobody asked to export.

## Consequences

- Four new local-only keys (`local:editorDrafts`, `local:writeQueue`,
  `local:undoStacks`, `local:writerId`) and one IndexedDB schema revision. None
  are in the backup settings allowlist or the content-script cache.
- Edits survive popup blur, but a write can still be refused or conflict. The
  status line is intentionally small; it does not offer conflict resolution.
- There is no UI for browsing arbitrary history in this change. `getHistory` and
  `restoreVersion` are storage-layer seams; the interaction users get is
  undo/redo plus the recorded recovery trail.
- Queue budgets deliberately favour safety over immediacy: a burst is one write,
  and a busy library waits its turn. The status line is what makes the wait
  legible.

## Revisit when

A user needs to resolve a conflict without retyping, or to pick an arbitrary old
version rather than step back one edit. That requires a real history picker and
an explicit conflict UI, not a different retry policy. Adding a queue consumer
outside the background also reopens the ownership decision above.
