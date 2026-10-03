# Module: Exporters

> Source: `src/lib/exporters/clipio.ts`
> Coverage target: 95%

## Purpose

Serializes Clipio snippets into a portable JSON format that can be imported back
into Clipio (or shared with other users).

## Scope

**In scope:** Clipio export format generation.
**Out of scope:** Import parsing, UI for triggering exports, file download handling.

---

## `buildClipioExport(snippets: Snippet[]): ClipioExportV1`

Produces a Clipio-format export object.

> **Renamed.** This section previously read `exportToClipio`. The implementation
> exports `buildClipioExport`; the spec heading was never updated, so every
> reader looking for `exportToClipio` found nothing. Corrected by
> `specs/coverage-honesty.spec.md`'s drift gate.

**Behavior:**

- Output has `{ format: "clipio", version: 1, snippets, exportedAt }`.
- Snippets include all fields.
- `exportedAt` is current ISO timestamp.
- Pure function, no side effects.

---

## `ClipioExport` Type

```ts
interface ClipioExport {
  format: "clipio";
  version: 1;
  snippets: Snippet[];
  exportedAt: string; // ISO 8601
}
```

---

## Error Handling

- Does not throw for any input.
- Returns valid export even for empty snippet array.

---

## Dependencies

- `Snippet` type — `src/types/index.ts`

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
