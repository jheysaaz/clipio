# Module: Manual Keyboard QA

> Coverage target: N/A (manual QA)

## Status: no such test file exists

> **Corrected.** This spec declared `> Source: e2e/manual-keyboard-qa.spec.ts`.
> That file does not exist and never has — `e2e/` contains `manual-qa-page.spec.ts`
> and `manual-qa-fields.spec.ts`, neither of which is a keyboard-navigation
> suite. The spec described a manual QA page rather than an automated test, and
> its scenarios below are a checklist for a human, not assertions anything runs.
> Found by the drift gate in `specs/coverage-honesty.spec.md`.

## What actually exists

| File                           | What it covers                                           |
| ------------------------------ | -------------------------------------------------------- |
| `e2e/helpers/manual-qa.html`   | The standalone harness page a human opens by hand        |
| `e2e/manual-qa-page.spec.ts`   | That the harness loads and wires the content script up   |
| `e2e/manual-qa-fields.spec.ts` | Every editable field expands a snippet; negatives do not |

The harness page and its automated contract are specified in
[`specs/manual-qa-page.spec.md`](./manual-qa-page.spec.md).

---

## Test Scenarios

The keyboard checklist below is **manual** — no automated test asserts these, so
they have to be walked by hand in the browser.

- Tab navigation through all interactive elements.
- Arrow key navigation in lists.
- Escape key closes dialogs.
- Enter/Space activates buttons.
- Focus management on dialog open/close.

If any of these regresses, nothing in CI will notice. They are candidates for
automated e2e coverage.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
