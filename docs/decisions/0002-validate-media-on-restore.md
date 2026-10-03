# 0002 — Validate media on restore, not only on import

**Status:** accepted · **Date:** 2026-09-27

## Context

`storage.sync` has a hard quota (see [0004](0004-refuse-sync-writes-over-quota.md)),
and media blobs are written to IndexedDB via `restoreMediaEntry` during ZIP import.

`restoreMediaEntry`'s docstring said:

> "Skips validation (size/type) since the data was previously validated on export."

That premise holds for *our own* export. It does not hold for an import: a ZIP is
attacker-supplied input, and `importClipioZip` takes `meta` straight from it.

## Decision

Validate size and type in `restoreMediaEntry`, exactly as `saveMedia` does. The
import path gets no weaker guarantee than the save path.

The dedup path checks an inflated-bytes figure before writing, so a small file that
declares a huge expansion is rejected before it reaches the store.

## Alternatives considered

**Validate only at `importClipioZip`.** Leaves any other caller of
`restoreMediaEntry` unguarded. Validation belongs at the boundary that writes.

**Trust the archive.** It is untrusted input.

## Consequences

An archive that would previously import successfully can now be rejected. That is
the intent — the previous behaviour was a hole, not a feature.

## Revisit when

Never. This is a correctness fix, not a tunable.