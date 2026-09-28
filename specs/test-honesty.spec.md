# Wave 5 — remove the tests that cannot fail

## Problem

The suite reported 1373 passing tests when this audit began (1425 now, after real tests were
added). A meaningful number of them cannot fail: they assert on
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
- [x] Every rewritten test is mutation-sensitive, with the one exception documented below (the
      `debugLog` watcher's double guard). A review round caught this line claiming _two_
      exceptions while documenting only one; the second, the `unused`-key check, is not a test
      exception at all — it is enforced by `pnpm check:locales` failing the build, which is
      mutation-verified, so it is listed under the gates rather than here.
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

## What the fifth review round found in the fourth round's fixes

Round 4's fixes to the _tests_ were real and mutation-verified. Its two fixes to _claims_ were
both false, and the first reproduced the exact shape round 4 existed to remove:

- `e2e-suite.spec.md` said "14 now" and then "What the 15 fall into" four lines later. The section
  whose stated purpose is that a stale count is unacceptable had two counts. The numbers are now
  stated once, and the three-way split is accurate — including the fact that the **largest** group
  (7 of 14) is post-keypress settles before a one-shot read, which a poll would handle better.
  Those are named as the first place to look next rather than defended.
- The "position-precise" suppression was a reword. `https://` contains `//`, so
  `<a href="https://x.io">Delete all snippets</a>` still lost its finding — and the comment named
  the URL case as the bug being fixed. Replaced with real comment-blanking (see above). Deleting
  the `*` guard also introduced a _new_ false positive: a JSX comment block being reported as
  user-visible text. Blanking fixes that too, so the limitation list documents only false
  negatives plus the one truncation case.

Two more fully decorative tests, both mutation-proven, both in files this work had edited:

- **`popup.spec.ts` "consumes context menu draft"** read `body` text and checked it was truthy.
  It passed with draft consumption removed outright (`if (typeof draft === "string" && draft)` →
  `if (false)`). It now polls the Plate contenteditable for the draft and asserts the draft is
  consumed from storage.
- **`options.spec.ts` "displays storage statistics"** did the same. It passed with the whole
  statistics panel replaced by an early `return null`. The figures now have stable testids
  (`stat-sync-kb`, `stat-local-kb`) and the test asserts their format.

Also: the export test wrapped `saveAs` in `.catch(() => {})` and then guarded the content check
with `existsSync`, so a failed download produced a green run; its `Array.isArray(parsed) || typeof
parsed === "object"` is true for _any_ `JSON.parse` result and asserted nothing. It now asserts the
seeded shortcuts are in the file. The feedback test wrapped three field fills in unasserted
`isVisible()` guards, so the form could be submitted empty. `image-gif.spec.ts` kept an
`expect(typeof response).toBe("object")` — the same unfailable pattern deleted from
`messaging.spec.ts` — next to a real assertion, so it was redundant.

Three hand-rolled `indexedDB.open("clipio-backup", N)` blocks existed across the suite, at three
different hardcoded versions (1, 1 and 2), none of which is the real `IDB_CONFIG.VERSION`. A
helper opening v1 against a v4 database throws `VersionError`, which reads as a product bug. All
three now go through `e2e/helpers/storage.ts`, which imports `IDB_CONFIG`.

## What the fourth review round found in the third round's fixes

The previous commit set out to delete false claims and introduced one: the sleep section of
`e2e-suite.spec.md` said "42 remain" three lines above the line saying 15. A commit whose stated
purpose is removing overclaims cannot ship one. Four more decorative assertions were found in the
very files it edited:

- **`popup.spec.ts` recovery banner** accepted "an alert exists OR the page mentions
  `sync`/`lost`/`warning`". Any page mentioning sync satisfies that. Forcing
  `showRecoveryBanner` to `false` still passed. It now seeds the `clipio-backup` IndexedDB store —
  the banner is driven by `tryRecoverFromBackup()`, which shows nothing when the backup is empty,
  so seeding `storage.sync` alone never raised it — and asserts the banner and its dismiss control.
- **`popup.spec.ts` quota banner** wrote ~91 KB into `storage.sync` and asserted only that `body`
  was visible, with a comment conceding the banner "may or may not appear". The banner needs
  `mode === "local" && localReason === "quota"`, so those keys are now seeded and the banner
  asserted. Forcing `quotaWarning` to `false` fails it. A sibling test for the third banner,
  `sync-paused`, had no coverage at all and now has one.
- **`messaging.spec.ts`** asserted `expect(typeof received).toBe("boolean")` where `received` is
  typed `Promise<boolean>` — unfailable, and passing even when the listener never matched and the
  promise resolved `false` on timeout. It now asserts `true`; changing the sent payload so the
  listener cannot match fails it.
- **`check-hardcoded-text.mjs`** replaced the `line.includes("*")` escape hatch that had been
  deleted as a finding with an `line.includes("//")` one, plus a co-line `t(` heuristic. Both were
  position-insensitive and dropped real findings. Fixing them with
  `before.lastIndexOf("//") > before.lastIndexOf("*")` was a reword, not a fix: `https://`
  contains `//`, so `<a href="https://x.io">Delete all snippets</a>` still lost its finding — while
  the comment named the URL case as the motivating bug. The script now **blanks comments** before
  scanning, preserving offsets so line numbers stay exact, with string-literal state tracked so a
  `//` or `/*` inside a quoted string is left alone. The `t(` heuristic is gone: a JSX text node
  cannot be an `i18n.t` call, since the character class excludes braces, so it could only ever hide
  real strings. The limitation list is **eight** items, including the single-word and
  lowercase-initial shapes (deliberate false negatives) and the one case blanking cannot fix — a
  `//` inside _JSX text_ truncates the reported string at that point, which loses no finding but
  reports the text imprecisely.

Also fixed: two sleep comments argued "a poll would not help because the read is one-shot", which
is not a reason — `expect.poll(() => input.inputValue())` works. The real justification for those
sleeps is the negative assertion, and the comments now say so. `normalize.test.ts` set `body` where
the migration reads `content`, so the legacy branch converted nothing; it now sets `content` and
asserts the converted result.

## What strengthening the vacuous e2e assertions exposed

Once those assertions stopped being able to pass, four tests failed — and three of the
failures were the tests being wrong, not the product:

- **The TextBlaze and PowerText imports never imported anything.** Both fixtures were the
  wrong shape: a CSV string, and an array of `{keyword, expansion}` objects. The wizard parses
  JSON, and the real TextBlaze export is `{version, folders:[…]}` while Power Text is a flat
  `shortcut → expansion` object. Each test then slept and asserted that `body` was visible, so
  the wizard saying _"Invalid JSON file. Please check the file and try again."_ passed the
  suite. Both now use real export shapes and assert the shortcuts reached `storage.sync`.
- **The context-menu draft test asserted against the wrong element.** The draft is pre-filled
  into a Plate.js editor, which renders into a `contenteditable`; the test queried
  `textarea, input[type="text"]` and therefore matched nothing. It now polls the contenteditable
  and additionally asserts the draft is _consumed_ from storage.
- **The arrow-key test asserted `body` was visible** after sleeping 100 ms between presses. The
  list is a `role="listbox"` using virtual focus via `aria-activedescendant`, so it now asserts
  three distinct active descendants across three positions and that ArrowUp walks back.

All three are mutation-verified: neutering the PowerText `Object.entries` loop, the
`content: draft` pre-fill, and the `ArrowDown` index advance each fail the corresponding test.

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
