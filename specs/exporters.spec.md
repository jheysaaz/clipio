# Module: Clipio Exporter

> Source: `src/lib/exporters/clipio.ts`
> Coverage target: 95%

## Purpose

Builds the versioned Clipio JSON export envelope that is serialised to a
downloadable `.json` file. The format is intentionally simple and stable so
that future versions of Clipio can always import data exported by older versions.

## Scope

**In scope:** Building the export envelope object.
**Out of scope:** JSON serialisation, file download, storage reads (handled by `StorageManager`).

---

## Data Model: `ClipioExport`

```ts
interface ClipioExport {
  version: 1; // Always the literal number 1
  format: "clipio"; // Always the literal string "clipio"
  exportedAt: string; // ISO 8601 timestamp of when the export was created
  snippets: Snippet[]; // The full snippets array, passed through unchanged
}
```

---

## Public API

### `buildClipioExport(snippets: Snippet[]): ClipioExport`

**Description:** Creates a versioned Clipio export envelope containing the
provided snippets array and a timestamp of the current moment.

**Behavior:**

- MUST return an object with `version` set to the literal `1`.
- MUST return an object with `format` set to the literal `"clipio"`.
- MUST set `exportedAt` to a valid ISO 8601 timestamp string representing the
  current time at the moment of the call (parseable by `new Date()`).
- MUST pass the `snippets` array through unchanged (same reference or identical value).
- MUST NOT mutate the input `snippets` array.
- MUST work correctly with an empty `snippets` array.

**Invariants:**

- `result.version === 1` always.
- `result.format === "clipio"` always.
- `new Date(result.exportedAt)` is a valid `Date` (not `NaN`).
- `result.snippets` equals the input array.

**Edge Cases:**

- Empty array `[]` → `snippets: []` in the output, all other fields still set.
- Single snippet → `snippets` has exactly one element.

**Examples:**

```ts
const export = buildClipioExport([]);
export.version    // → 1
export.format     // → "clipio"
export.snippets   // → []
new Date(export.exportedAt).getTime() // → valid timestamp (not NaN)
```

---

## Error Handling

This function does not throw. It has no error conditions — it simply wraps
whatever is passed in.

## Dependencies

None beyond the `Snippet` type. Fully unit-testable without mocks.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
