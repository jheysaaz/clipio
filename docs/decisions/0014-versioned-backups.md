# 0014 — Versioned full backups with a preview before restore

**Status:** accepted · **Date:** 2026-11-21

## Context

The existing Export/Import flow is a *portable snippet interchange*. It writes
snippets (and, in v2, their images) as JSON or a ZIP and imports them through a
four-step wizard. It deliberately says nothing about settings. That is the right
shape for moving a library between Clipio and another tool, but it is a poor
answer to "I am about to reinstall the extension — how do I get everything
back?".

A full backup has a different risk profile. It can restore settings that change
where future writes go (`storageMode`), and it can overwrite snippets the user
currently has. Reusing the import button for that, or letting a file write as
soon as it is chosen, would put a destructive action behind a step named
"import".

## Decision

Backups are a separate control in the Library panel, with two buttons: **Back
up** and **Restore**. The Export/Import contract (`export-json`, `import-open`,
`import-formats`) is unchanged.

The v3 format is a ZIP containing:

- `backup.json` — a `clipio-backup` v3 envelope with `exportedAt`, `snippets`,
  `media` metadata and an allowlisted `settings` object;
- `media/<id>.<ext>` — one image blob per media record, with the extension
  derived from the MIME type.

Legacy v1 JSON snippets and v2 `.clipio.zip` exports remain restorable. They are
migrated to the v3 envelope in memory, in `normalizeBackupEnvelope`; no file on
disk is rewritten. A v1/v2 file carries no settings, so its migrated envelope
has an empty settings object. Unknown `format` values and unknown versions are
refused.

### Settings scope is an allowlist of raw storage keys

`backup-settings.ts` names every setting a backup may contain. These are the
**raw** `browser.storage.local` keys — WXT strips the `local:` prefix when it
writes, so `local:themeMode` would read nothing. A new storage item is not in a
backup until someone adds it to the list, gives it a validator and records why
here.

Secrets (`giphyApiKey`), logs (`debugLog`), local analytics
(`snippetUsageCount`, `totalSnippetInsertions`) and context history
(`snippetContextUsage`) are excluded by name and by test, not by omission. A
settings object with an invalid value is not a reason to lose the other
settings: each key is validated independently and invalid ones are reported as
skipped in the preview and again in the restore summary. A failed write is
caught per key and reported the same way.

### Restore is dry-run first, write second

Choosing a file parses it, builds a v3 envelope and computes a preview. Nothing
is written during this step. The preview shows snippet and image counts, the
settings that would change, the settings that would be skipped, malformed
records that were rejected, missing image blobs, and every id/shortcut conflict.

Conflicts use the import wizard's `detectConflicts` and `suggestShortcut`
functions, so the two paths cannot disagree about what a conflict is. Each
conflict defaults to `skip`; the user may choose `skip`, `overwrite` or `rename`.
Only the **Restore selected snippets** button calls the writer. Settings are
applied before snippets because `storageMode` determines where the snippet
write goes. Media restore failures are non-fatal and reported: one bad image
must not cost the user the snippets that reference the others.

[0002](0002-validate-media-on-restore.md) still applies. Restored blobs go
through `restoreMediaEntry`, which validates size and type; a backup file is no
more trusted than an import file.

## Alternatives considered

- **Extend the existing Export/Import wizard.** It would have made an
  overwrite-capable action look like the familiar, additive import. It would
  also have forced settings into a parser interface whose `ParsedSnippet`
  contract has no place for them.
- **Back up everything in `storage.local`.** Convenient until a new key lands:
  the secret, log or context-history item would silently join every backup.
  The allowlist makes inclusion a reviewable decision.
- **Write on file selection and show a summary afterwards.** That is not a
  preview. The whole point of the dry-run step is that the user can still say
  no.

## Consequences

- The v3 envelope has a version field, so a future format change can be refused
  explicitly rather than parsed as something it is not.
- Adding a setting to backups requires a validator and a test. Forgetting is an
  intentional no-op: the setting stays local.
- The restore UI has more states than the import wizard (loading, preview,
  restoring, done, error). They are modelled in a small store so the component
  only renders them.
- Bundle budgets are a ratchet. If the new options UI pushes an options chunk
  over its budget, the budget may only be raised after a measured clean build,
  with the reason recorded in the change.

## Revisit when

A fourth format needs fields beyond snippets, images and settings, or a setting
needs to be backed up that cannot be validated without reading another store.
Both require a new version of the envelope, not an extension of v3's shape.
