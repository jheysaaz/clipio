# Module: Sentry PII Scrubber

> Source: `src/lib/sentry-scrub.ts`
> Coverage target: 90%

## Purpose

Provides PII (Personally Identifiable Information) scrubbing for Sentry events
and breadcrumbs before they are transmitted to the Sentry ingest endpoint.

The strategy is **moderate scrubbing**: preserve diagnostic metadata (error
messages, stack traces, shortcut keys, snippet IDs) while redacting user-generated
content (snippet body, clipboard data, raw text inputs).

## Scope

**In scope:** Scrubbing `event.extra`, `event.contexts`, and `breadcrumb.data`
fields. Truncating long console breadcrumb messages.
**Out of scope:** Scrubbing stack traces, error messages, tags, or request URLs
(these are considered safe diagnostic data).

---

## Sensitive Keys

The following object keys are considered sensitive. Their values are replaced
with the literal string `"[REDACTED]"`:

```
content, snippet, snippetContent, clipboard, clipboardText,
body, text, html, rawContent, value, newValue, oldValue,
cachedSnippets, items
```

This set is a closed list — keys not in this set are NOT redacted (even if their
values look like user content).

---

## Public API

### `scrubEvent(event: Event): Event`

**Description:** Scrubs a Sentry event in-place, replacing sensitive field values
with `"[REDACTED]"`. Returns the mutated event.

**Behavior:**

- MUST scrub `event.extra` by running `redactObject` on it when it is a non-null object.
- MUST scrub each value in `event.contexts` by running `redactObject` on it.
- MUST NOT modify `event.exception`, `event.message`, `event.tags`, `event.level`, or `event.breadcrumbs`.
- MUST handle `event.extra === undefined` gracefully (no-op).
- MUST handle `event.contexts === undefined` gracefully (no-op).
- MUST return the same event object (mutated in-place).

**Redaction rules (via `redactObject`):**

- MUST replace the value of any key in `SENSITIVE_KEYS` with `"[REDACTED]"`.
- MUST recurse into nested plain objects (non-array, non-null).
- MUST NOT recurse into arrays.
- MUST preserve keys not in `SENSITIVE_KEYS` unchanged.
- MUST NOT redact the key itself — only its value.

**Examples:**

```ts
scrubEvent({
  extra: { content: "my snippet body", snippetId: "abc123" },
});
// → extra: { content: "[REDACTED]", snippetId: "abc123" }

scrubEvent({
  extra: { nested: { text: "sensitive", id: "safe" } },
});
// → extra: { nested: { text: "[REDACTED]", id: "safe" } }

scrubEvent({
  extra: { items: ["a", "b"] },
});
// → extra: { items: "[REDACTED]" }  (array is the value of "items" → redacted, not recursed)
```

---

### `scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb`

**Description:** Scrubs a Sentry breadcrumb before it is attached to an event.

**Behavior:**

- MUST scrub `breadcrumb.data` by running `redactObject` on it when it is a non-null object.
- MUST handle `breadcrumb.data === undefined` gracefully (no-op).
- MUST truncate `breadcrumb.message` to 200 characters and append `" [truncated]"` when:
  - `breadcrumb.category === "console"` AND
  - `breadcrumb.message` is a string longer than 200 characters.
- MUST NOT truncate `breadcrumb.message` for non-console breadcrumbs.
- MUST NOT truncate `breadcrumb.message` when it is ≤ 200 characters.
- MUST return the same breadcrumb object (mutated in-place).

**Examples:**

```ts
scrubBreadcrumb({
  category: "console",
  message: "a".repeat(201),
  data: { content: "secret" },
});
// → { message: "a".repeat(200) + " [truncated]", data: { content: "[REDACTED]" } }

scrubBreadcrumb({
  category: "fetch",
  message: "a".repeat(201),
  data: {},
});
// → { message: "a".repeat(201), data: {} }  (no truncation for non-console)
```

---

## Error Handling

- Both functions MUST NOT throw for any input.
- `null` or `undefined` `event.extra` / `breadcrumb.data` MUST be handled gracefully.

## Dependencies

- `@sentry/browser` — `Event` type (import only, no runtime dependency).
- `@sentry/core` — `Breadcrumb` type (import only, no runtime dependency).

In tests, these types can be cast directly from plain objects without needing
the actual Sentry SDK at runtime.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
