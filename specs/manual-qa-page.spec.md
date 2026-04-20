# Module: Manual QA Page (Dev Harness)

> Source: `e2e/helpers/manual-qa.html`, `e2e/helpers/serve.mjs`, `src/entrypoints/background.ts`
> Coverage target: N/A (dev utility, covered by e2e smoke checks)

## Purpose

Provide a dedicated manual testing page for validating snippet expansion behavior
across a broad set of editable surfaces, with special focus on
`contenteditable` edge cases and edited snippet content.

## Scope

**In scope:**

- A local HTTP page containing diverse editable targets used for manual QA.
- Developer helpers for common test flows (clear fields, focus helpers).
- Dev-mode auto-open behavior so the page appears in the same browser session
  as the extension while running `pnpm dev`.

**Out of scope:**

- Production user flows.
- End-user facing UI text polish.

## Manual QA Page Behavior

- MUST expose at least these editable targets:
  - single-line text input
  - textarea
  - plain contenteditable div
  - nested contenteditable region
  - contenteditable prefilled with mixed inline formatting
- MUST include at least one non-supported target for negative testing
  (`password`, `readonly`, or `disabled`).
- MUST include visible instructions describing baseline shortcuts to test
  (`/hello`, markdown, cursor, clipboard/date placeholders).
- MUST include test-id attributes on core editable targets for optional e2e
  assertions.

## Dev Auto-Open Behavior

- In development mode only, extension startup MUST open
  `http://localhost:7777/manual-qa.html` once per dev session.
- Auto-open MUST be gated so it does not repeatedly open tabs on every reload.
- Auto-open failures (e.g. server not started) MUST be non-fatal and MUST NOT
  block extension startup.

## Error Handling

- Missing local server MUST fail gracefully (no crash).
- Page-level helper scripts MUST avoid throwing on absent optional elements.

## Dependencies

- `e2e/helpers/serve.mjs` for local HTTP serving.
- `browser.tabs.create()` for opening the dev QA tab.
- Dev mode detection via `import.meta.env.MODE`.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-04-19 | Initial spec | —      |
