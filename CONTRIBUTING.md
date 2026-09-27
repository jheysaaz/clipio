# Contributing to Clipio

## E2E test coverage contract

The Playwright suite in `e2e/` guards real extension behavior. To keep it
catching regressions instead of breaking on trivia:

- **Any PR that changes visible copy or restructures a component's DOM must
  run the e2e suite locally (`pnpm test:e2e`) before merge.**
- **Any component with e2e coverage keyed to a `data-testid` must not have
  that testid removed or repurposed without updating the corresponding test
  in the same PR.**
- E2E tests must assert behavior/state via role-based locators,
  `data-testid`, or `aria-label` — not literal UI copy scraped from
  `textContent("body")` or bare `:has-text()` container matches. Copy-only
  changes should never fail a test unless the test is specifically about
  copy/i18n.
- Do not fix a failing e2e test by loosening its assertion or adding
  retries/timeouts; diagnose the actual cause. If the app behavior itself
  looks wrong, flag it for a human instead of adapting the test to it.

Testing standards and the current repair notes live in
`specs/e2e-suite.spec.md`.
