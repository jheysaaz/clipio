# Module: Snippet Preview

> Source: `src/lib/snippet-preview-ui.ts`
> Coverage target: 85%

## Purpose

Owns the snippet palette that appears next to the caret: which snippets to show,
where to anchor it, and how to get it out of the way.

## Scope

**In scope:** Preview visibility, positioning, filtering, dismissal.
**Out of scope:** Rendering snippet _content_ to HTML (that is the editor's
serialisation path in `src/components/editor/serialization.ts`), snippet
persistence.

---

## What this module actually contains

> **Corrected.** This spec previously documented a
> `renderSnippetPreview(snippet, options): string` pure function returning HTML,
> "returning empty string on failure". **That function does not exist.** The
> module is a DOM-owning class, `SnippetPreviewUI`, plus a shared singleton.
> There is no pure rendering entry point here at all — an earlier revision of
> this spec described an architecture the implementation never adopted.
> Found by the drift gate in `specs/coverage-honesty.spec.md`.

---

## `SnippetPreviewUI`

A class owning one preview element per page. Exported alongside a ready-made
instance so callers do not each construct their own.

### `show(position: PreviewPosition, snippets: FilteredSnippet[]): void`

Renders the palette at `position` for the given snippets.

The position is supplied by the caller rather than measured here, because caret
measurement differs per input type and lives in `src/lib/preview-helpers.ts` —
see `specs/preview-anchor.spec.md`.

### `hide(): void`

Removes the palette. Idempotent: calling it when nothing is shown is a no-op, so
callers do not have to track visibility themselves.

---

## `snippetPreviewUI`

The shared singleton. The content script creates one per page and reuses it, so
repeated expansions do not rebuild the DOM each time.

---

## Error Handling

- This module manipulates the DOM directly and does not throw to callers for
  ordinary states (already hidden, empty match list).
- Markdown and placeholder _content_ conversion is not this module's
  responsibility; failures there surface through the editor serialisation path
  and are covered by `specs/content-format-migration.spec.md`.

---

## Dependencies

- `src/lib/preview-helpers.ts` for filtering and position calculation.
- `src/lib/content-helpers.ts` for placeholder processing.
- The `#i18n` module for its labels.

---

## Change History

| Date       | Change                                                                             | Author |
| ---------- | ---------------------------------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                                                       | —      |
| 2026-10-02 | Corrected: replaced the never-built `renderSnippetPreview` with the real class API | —      |
