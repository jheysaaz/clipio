# Module: Snippet Model

> Source: `src/types/index.ts`
> Coverage target: 95%

## Purpose

Defines the canonical `Snippet` data model and the `createSnippet` factory
function used everywhere snippets are created. Provides the single source of
truth for the shape of a snippet in the system.

## Scope

**In scope:** Type definitions, factory function, field defaults.
**Out of scope:** Persistence, validation of business rules (duplicate shortcuts,
empty labels), or any UI logic.

---

## Data Model

### `Snippet`

| Field        | Type       | Required | Description                         |
| ------------ | ---------- | -------- | ----------------------------------- |
| `id`         | `string`   | Yes      | Unique identifier (UUID v4)         |
| `label`      | `string`   | Yes      | Human-readable name                 |
| `shortcut`   | `string`   | Yes      | Trigger text for auto-expansion     |
| `content`    | `string`   | Yes      | Markdown body of the snippet        |
| `tags`       | `string[]` | No       | Optional categorization tags        |
| `usageCount` | `number`   | No       | Times the snippet has been expanded |
| `createdAt`  | `string`   | Yes      | ISO 8601 timestamp of creation      |
| `updatedAt`  | `string`   | Yes      | ISO 8601 timestamp of last update   |

### `SnippetFormData`

Subset of `Snippet` used as the input to `createSnippet()`:

| Field      | Type       | Required |
| ---------- | ---------- | -------- |
| `label`    | `string`   | Yes      |
| `shortcut` | `string`   | Yes      |
| `content`  | `string`   | Yes      |
| `tags`     | `string[]` | No       |

---

## Public API

### `createSnippet(form: SnippetFormData): Snippet`

**Description:** Creates a new `Snippet` from form data, generating a unique ID
and ISO timestamps. No server or storage interaction occurs.

**Behavior:**

- MUST return an object satisfying the `Snippet` interface.
- MUST generate a unique `id` using `crypto.randomUUID()`.
- MUST set `createdAt` and `updatedAt` to the same current ISO 8601 timestamp.
- MUST copy `label`, `shortcut`, and `content` from the input unchanged.
- MUST set `tags` to `form.tags` if provided, or `[]` if `form.tags` is `undefined`.
- MUST set `usageCount` to `0`.
- MUST NOT mutate the `form` input.

**Invariants:**

- `id` matches UUID v4 pattern: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
- `createdAt === updatedAt` immediately after creation (both set from the same `Date`).
- `createdAt` is a valid ISO 8601 string parseable by `new Date()`.
- Two successive calls produce different `id` values (probabilistic guarantee via UUID).

**Edge Cases:**

- `form.tags` is `undefined` → `tags` is `[]`, not `undefined`.
- `form.tags` is `[]` → `tags` is `[]`.
- `form.content` is empty string → stored verbatim, no validation.

**Examples:**

```ts
const snippet = createSnippet({
  label: "Hello",
  shortcut: "hi",
  content: "Hello world!",
});
snippet.id; // → "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
snippet.label; // → "Hello"
snippet.shortcut; // → "hi"
snippet.content; // → "Hello world!"
snippet.tags; // → []
snippet.usageCount; // → 0
snippet.createdAt === snippet.updatedAt; // → true
```

---

## Error Handling

`createSnippet` does not validate its input. Callers are responsible for ensuring
form fields are non-empty before calling this function.

---

## Shortcut Conflict Detection

> Source: `src/lib/snippetUtils.ts`

### `detectShortcutConflict(candidate, existingSnippets, excludeId?): ShortcutConflict | null`

Checks whether a candidate shortcut conflicts with any existing snippet's
shortcut. Used by the snippet creation form (`NewSnippetView`) to block saving
when a conflict is detected.

**Two conflict types:**

| Type     | Condition                         | Example                  |
| -------- | --------------------------------- | ------------------------ |
| `exact`  | `candidate === existing.shortcut` | `/comp` vs `/comp`       |
| `prefix` | one starts with the other         | `/comp` vs `/compatible` |

**Behavior:**

- MUST return `null` when `candidate` is empty
- MUST return `null` when `existingSnippets` is empty
- MUST return `{ type: "exact", conflictingSnippet }` on exact match
- MUST return `{ type: "prefix", conflictingSnippet }` when candidate is a
  prefix of an existing shortcut or vice versa
- MUST skip the snippet matching `excludeId` (for future edit support)
- MUST return the first conflict found (array iteration order)
- Comparison MUST be case-sensitive

## Dependencies

- `crypto.randomUUID()` — available in all modern browsers and Node ≥ 15.
  No mocking required for tests (the test environment provides it).
- `Snippet` type — `src/types/index.ts`

## Change History

| Date       | Change                                         | Author |
| ---------- | ---------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                   | —      |
| 2026-03-14 | Add shortcut conflict detection (snippetUtils) | —      |
