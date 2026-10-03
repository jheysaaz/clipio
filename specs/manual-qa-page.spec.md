# Module: Manual QA Page

> Source: `e2e/helpers/manual-qa.html`
> Coverage target: N/A (manual QA)

## Purpose

Standalone HTML page for manual testing of snippet expansion in content scripts.

## Scope

**In scope:** Content script injection testing, expansion verification.
**Out of scope:** Automated tests.

---

## Features

- Editable content areas for testing.
- Shortcut trigger test cases.
- Debug logging display.

---

## Automated coverage

`e2e/manual-qa-page.spec.ts` asserts the harness exposes its targets.
`e2e/manual-qa-fields.spec.ts` drives it as a release gate for the fields
themselves, because the page is the only fixture that holds a **pre-filled**
contenteditable:

| Field | Expectation |
| ----- | ----------- |
| `#qa-input`, `#qa-textarea`, `#qa-ce-basic`, `#qa-ce-nested` | Typing a shortcut at the caret opens the preview, then expands |
| `#qa-ce-rich` (pre-filled rich HTML) | Same, **with no space before the shortcut** — the caret follows a full stop, which is what regressed |
| `#qa-password`, `#qa-new-password` | Keystrokes stay verbatim, no preview |
| `#qa-readonly` | Value unchanged, no preview |

The `#qa-ce-rich` case is the load-bearing one. Its content ends in `.`, so it is
the only field where the trigger is not preceded by whitespace, and it was the
only field where neither the palette nor expansion ever fired. See
`specs/shortcut-boundary.spec.md`.

Of the negatives, `#qa-new-password` is the one that catches a real regression:
`type="new-password"` reports `input.type === "text"`, so a gate written against
that property lets sign-in and change-password forms through. `#qa-readonly` is
belt-and-braces — the control rejects the keystrokes itself — but it still guards
the "never open a palette here" claim.

The `data-testid` attributes are part of this coverage and may not be removed or
repurposed without updating these tests in the same change.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
| 2026-10-02 | Documented the automated field coverage | — |
