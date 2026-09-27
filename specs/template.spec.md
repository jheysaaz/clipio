# Module: Template System

> Source: `src/lib/template.ts`
> Coverage target: 85%

## Purpose

Handles snippet template processing with variable substitution.

## Scope

**In scope:** Template parsing, variable substitution.
**Out of scope:** Snippet CRUD, UI.

---

## `processTemplate(template: string, variables: Record<string, string>): string`

**Behavior:**

- Replaces `{{variable}}` placeholders with values from `variables`.
- Leaves unknown placeholders intact.
- Pure function.

---

## Error Handling

- Returns original template on error.
- Does not throw.

---

## Dependencies

- None.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |