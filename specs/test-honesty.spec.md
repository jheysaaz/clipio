# Wave 5 — remove the tests that cannot fail

## Problem

The suite reports 1373 passing tests. A meaningful number of them cannot fail: they assert on
values the test itself constructed, re-implement the logic they claim to check, or are skipped
entirely behind a conditional. That is worse than having no test, because it inflates the count
and creates a false impression of coverage — and every one of them was found by reading, not by
the suite.

AGENTS.md already forbids this (rule 1: never re-implement a function's logic inside a test;
rule 4: every feature needs a negative test; rule 9: a test file must import the code under
test). The rules exist; this wave makes the suite obey them.

### The inventory, verified rather than assumed

Each claim below was re-checked against the current tree before acting.

| File                            | Claim                                                                                                                                   | Verified?                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `ResizableMediaWrapper.test.ts` | 13 tests, imports only `vitest`; re-implements `clampWidth()` and duplicates `MIN_WIDTH = 40` with a "must match the value in…" comment | **yes** — only import is `vitest` |
| `preview-privacy.test.ts`       | 5 of 6 decorative; only `:118-132` exercises real code                                                                                  | yes                               |
| `messages.test.ts`              | 5 of 6 assert on locally-constructed literals                                                                                           | yes                               |
| `preview-helpers.test.ts:17-25` | `vi.mock("~/lib/markdown")` re-implements `markdownToPlainText` with its own regexes                                                    | yes                               |
| `e2e/options.spec.ts`           | 4 vacuous `if`-guards, one of which skips an entire test body                                                                           | yes                               |
| `e2e/image-gif.spec.ts:373-390` | cannot fail; the comment concedes it proves nothing                                                                                     | yes                               |

### One ledger claim rejected

The ledger says of `ResizableMediaWrapper`: _"Delete the component and all 13 stay green."_

**False, and acting on it would have deleted a feature.** `ResizableMediaWrapper` is imported
by both `ImagePlaceholder.tsx:11` and `GifPlaceholder.tsx:10` — it is what makes a pasted image
or GIF resizable in the editor. Deleting it would remove image resizing entirely.

The real finding is narrower and more useful: the component contains **genuine, testable pure
logic** that the fake tests declined to test, and that logic is **duplicated** —
`Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta))` appears verbatim in both the
mousemove and mouseup handlers, and `MIN_WIDTH` is a private constant the test had to copy by
hand.

## Solution

Delete what is empty; fix what is salvageable. No test is kept merely because it exists.

- **`ResizableMediaWrapper`** — extract `MIN_WIDTH` and a pure `clampWidth(startWidth, delta,
maxWidth)` into exported functions, use `clampWidth` in both handlers (removing the
  duplication), and rewrite the tests against the real exports. `getScrollParentWidth` is
  exported and tested against a real DOM, since the clamp is meaningless without it.
- **`preview-privacy.test.ts`** — keep the one test that exercises real code, delete the other 5.
- **`messages.test.ts`** — rewrite the five to assert on the module's output.
- **`preview-helpers.test.ts`** — delete the hand-rolled markdown mock and let the real module
  run.
- **e2e** — replace each `if (guard) …` with the assertion it was standing in for, so a failure
  is a failure rather than a skip.

## Acceptance Criteria

- [x] `ResizableMediaWrapper`'s clamp is implemented once, not twice.
- [x] Its tests import the module that holds the clamp (`mediaResize.ts` — the component
      itself imports `#i18n`, a WXT virtual module with no test alias, so it cannot be imported by a
      unit test at all) and fail if the clamp is broken.
- [x] `getScrollParentWidth` is tested against a real DOM.
- [x] No remaining test in the files this wave touched asserts on a value it constructed
      itself. The two exceptions found in `items.test.ts` were deleted rather than kept: they drove
      the file's own `vi.mock`, so only mutating the mock could fail them.
- [x] No e2e test can be silently skipped by a failed precondition. Three more guards of this
      shape were found by review and removed (the feedback form in `options.spec.ts`, which filled
      nothing if the fields were absent), along with a four-way `||` disjunction in
      `popup.spec.ts` that was true of essentially any options page.
- [x] No test claims less than it verifies. The Clipio import test originally stopped at
      "wizard parsed the file", on a stated belief that the footer's Next button could not be
      targeted at all. Review proved that belief false — all four selectors resolve — so the test
      now drives the wizard through and asserts the imported snippets reached `storage.sync`.
- [x] Every rewritten test is mutation-sensitive, with the two documented exceptions below
      (the `debugLog` watcher's double guard, and the `unused`-key check, which is enforced by CI
      rather than by a unit test).
- [x] The suite's pass count went **down** (1373 → 1368 in `c339b04`) before rising again as
      real tests were added. That is the point, and it is not a regression.

## A test that is robust to mutation for a legitimate reason

The debug-mode watcher tests in `debug.test.ts` assert that `watch` is registered exactly
once per process. Two independent guards enforce that: the `_debugEnabled !== null`
early-return in `ensureInitialised`, and the `_watching` flag around the registration. Removing
**either one alone** leaves the tests green, because the other still holds.

So no single-line mutation is caught, and this is recorded rather than papered over. It is
defence in depth rather than a gap: the behaviour is pinned, and it would take changing both
guards at once to break it. The test names and comments describe the behaviour and explicitly do
not claim to cover the `_watching` flag, because they do not.

## What this wave found by removing the guards

Removing the vacuous guards exposed two things the green suite was actively hiding. That is the
argument for the work.

### 1. The Clipio import e2e never imported anything

It looked for a button named `/import|confirm/i` and wrapped the click in `if (visible)`. The
wizard is four steps and its footer button on step 1 is **"Next"**, so the selector matched
nothing, the guard was always false, and the import was never performed. The test then asserted on
whatever the page showed and passed.

It now drives the wizard through and asserts the imported snippets reached `storage.sync`. Steps 2
and 3 are skipped by the wizard itself when there are no unsupported placeholders or conflicts, so
from a clean export it is one **Next** click and one **Import N snippets** click.

Verified sensitive: not clicking the import button fails it with "imported snippets never reached
storage".

**A note on how this was got wrong first.** An intermediate revision of this spec claimed the
footer's Next button "could not be targeted by any of role+name, `filter({ hasText })`,
`locator({ hasText })` or position, despite its text being exactly 'Next'", and left the import
unverified on that basis, with a `data-testid` proposed as the fix. That was false, and it was
false because the failure had been diagnosed once — a stale assumption about the wizard's labels —
and then never re-tested. Every one of those selectors resolves. The rule this earns: a claim
about _why_ something is hard is a claim like any other, and it gets the same verification as the
fix.

### 2. The width-suffixed image test never opened the Images section

`image-gif.spec.ts` loaded `options.html#images` and asserted the page text contained "image". The
hash does not route — there is no hash routing in the options app at all; the page came up on the
**Dashboard**, where the only "image" on screen is the sidebar's own "Images" link, and the string
occurs exactly once on the page. The test passed without ever opening the section it claimed to
test.

It now clicks `options-nav-images`, waits for `aria-current="page"`, and asserts against the
specific image's row via a new `image-row-<id>` testid, added to **both** view modes (the first
attempt put it only on the grid row, and the default view is list, so the test still failed).

Verified sensitive at the e2e level: removing the width-suffix support from `ImagesSection`'s
reference regex makes it fail with the row reading "Not used in any snippets".

## Edge Cases

- **Deleting a test can hide a real bug.** A decorative test is only safe to delete once
  confirmed to assert nothing. Where the intent was real, the fix is to write the test properly,
  not to delete it.
- **`MIN_WIDTH` drift is the actual bug the fake test was gesturing at.** It copied the constant
  with a comment saying it must match, which means changing the constant would not fail
  anything. Exporting it removes the possibility entirely.
- **A vacuous `if` guard in e2e is worse than a missing test**, because the test name still
  appears in the report. Each one is replaced with the assertion it should have made.

## Non-Goals

- Deleting `ResizableMediaWrapper`, for the reason above.
- The 83 remaining `waitForTimeout` calls. That is mechanical but large, touches many files, and
  deserves its own item with its own verification rather than being folded in here.
- Raising coverage numbers. Several changes here _reduce_ the pass count on purpose.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-27 | Initial spec | —      |
