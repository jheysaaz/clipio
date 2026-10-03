# Spec classification — all 47, with reasons

> Supporting detail for Q5 in [`RESTRUCTURE-PLAN.md`](./RESTRUCTURE-PLAN.md).
> Every spec is listed. Nothing is left as "delete these 40 similar ones".

**Numbers:** 47 files, 5,786 lines, against 25,351 lines of source.
36 have a `> Source:` header. **36 of 47 already have a matching unit test.**

---

## The four groups

| Group | Files | Lines | Fate |
|---|---|---|---|
| **A. Duplicates the test suite** | 30 | 3,180 | Delete. The test already says it, and says it more precisely. |
| **B. About the test suite itself** | 5 | 1,046 | Collapse to `AGENTS.md`. Rules belong where the agent reads them. |
| **C. Component with no test** | 7 | 1,340 | Keep, but shrink — these describe untested code, so the prose has a job *for now*. |
| **D. Decision history** | 5 | 220 | Convert to 5 ADRs in `decisions/`. |

---

## Group A — duplicates the test suite (30 files, 3,180 lines)

**Why delete.** Kent Beck, `Canon TDD`, defines the first step of TDD as a *Test
List* — "list all the expected variants in the new behavior... This is analysis,
but **behavioral** analysis." The tests that follow **are** that list, made
executable. A spec file restating them is a second copy that must be kept in sync
with the first.

Ham Vocke, *The Practical Test Pyramid*:
> "You rather become fed up with those stupid tests failing every time you
> refactoring, causing more work than being helpful."

The failure mode is the reverse of what specs are for: a prose file that a
refactor cannot break goes stale silently, and then it lies.

**The evidence that this already happened to you.** My drift checker found 7
specs describing code that no longer existed — including `template.spec.md`,
documenting a module absent from all of git history, and `messages.spec.md`,
documenting a `MessageMap` API that was never built. **That is group A decaying,
already, in your repo.**

| Spec | Covered by |
|---|---|
| `markdown` | `markdown.test.ts` (76 tests) |
| `update-checker` | `update-checker.test.ts` (70) |
| `review-prompt` | `review-prompt.test.ts` (37) |
| `shortcuts` | `shortcuts.test.ts` (37) |
| `content-expansion` | `content-helpers.test.ts` (67) |
| `media-placeholders` | `media-placeholders.test.ts` (41) |
| `importers` | `importers/*.test.ts` (5 files) |
| `exporters` | `exporters/clipio.test.ts` |
| `date-utils` | `dateUtils.test.ts` |
| `preview-helpers` | `preview-helpers.test.ts` (35) |
| `storage` | `storage/*.test.ts` (9 files) |
| `usage-tracking` | `usageTracking.test.ts` (21) |
| `ui-font` | `ui-font.test.ts` |
| `sentry-scrub` | `sentry-scrub.test.ts` |
| `serialization` | `serialization.test.ts` |
| `dom-text-range` | `dom-text-range.test.ts` |
| `giphy` | `giphy.test.ts` |
| `copy-markdown-as-rich-text` | `copyMarkdownAsRichText.test.ts` |
| `snippet-model` | `snippetUtils.test.ts`, `types/index.test.ts` |
| `html-to-markdown` | `html-to-markdown.test.ts` |
| `blocked-sites` | `blocked-sites.test.ts` |
| `image-dedup` | `media.test.ts` |
| `content-format-migration` | `content-format-migration.test.ts` |
| `import-validation` | `importers/clipio.test.ts` |
| `storage-durability` | `backends/sync.durability.test.ts` |
| `cache-coherence` | `manager.cache.test.ts` |
| `storage-quota-preflight` | `quota-preflight.test.ts` |
| `snippet-preview` | `snippet-preview-ui*.test.ts` |
| `developers-section` | `debug.test.ts` |

## Group B — about the test suite itself (5 files, 1,046 lines)

**Why collapse into AGENTS.md.** These don't describe the product; they describe
how we test. `test-honesty.spec.md` ("remove the tests that cannot fail") and
`test-infrastructure.spec.md` are audit reports about work that is *finished*.
`e2e-suite.spec.md` is a mix of rules and a repair log.

Osmani, from his analysis of 2,500+ agent config files, found the useful parts of
an agent file are six things: commands, testing, structure, style, git, and
boundaries. Testing rules belong there.

Thoughtworks Radar rates `AGENTS.md` **Trial** and `curated shared
instructions` **Adopt** — so the adoptable half of this whole movement is
short, curated instructions, not the spec pipeline.

| Spec | Lines | Fate |
|---|---|---|
| `test-honesty` | 264 | Rules → AGENTS.md. The audit itself is done. |
| `e2e-suite` | 199 | Keep only the selector rules. The repair log is noise. |
| `test-infrastructure` | 214 | Done work. Delete. |
| `i18n` | 174 | Dead-key rules → AGENTS.md. The key list is in `en.yml`. |
| `manual-keyboard-qa` | 26 | Already marked "never existed". Delete. |

## Group C — a component with no test (7 files, 1,340 lines)

**Why keep, for now.** This is the honest exception. The rule "the test is the
spec" only works if there *is* a test. These describe code with none:

`ConfirmDialog`, `ImportWizard`, `NewSnippetView`, `SnippetDetailView`,
`ImagePicker`, `icon-system`, `content-security`.

Since you're bringing coverage to 80% across the board, **these get tests, and
then they get deleted like group A.** I'm not proposing to keep them
permanently — they're a bridge, and I'll flag each one as its test lands.

## Group D — decision history (5 files, 220 lines)

**Why convert to ADRs.** These record *why* something is the way it is, and the
reason is a reversal. Code cannot hold that.

Michael Nygard, who invented ADRs at Cisco:
> "If a decision is reversed, we will keep the old one around, but mark it as
> superseded."

Fowler's version:
> "**They should not be modified if the decision is changed, but linked to a
> superseding decision.**"

Every one of your 47 has a `Change History` table. Nygard:
> "**Large documents are never kept up to date.**"

`git log` already knows the history. What it can't tell you is the *reason*, which
is what these 5 actually contain.

| Spec | The decision worth keeping |
|---|---|
| `content-script-trust` | Reject synthetic `KeyboardEvent`s — `isTrusted` check |
| `media-import-hardening` | Validate media from ZIPs, not trust the archive |
| `preview-encapsulation` | Shadow DOM, page scripts cannot reach the rows |
| `preview-privacy` | Do not send browsing hostnames to Sentry |
| `storage-quota-preflight` | Refuse a sync write rather than silently downgrade |

---

## What replaces them

| File | Holds | Budget |
|---|---|---|
| `PRODUCT.md` | What Clipio is for. User jobs. Non-goals. Decisions → reason → revisit when. | ~150 lines |
| `ARCHITECTURE.md` | Entrypoints, storage layers, `#i18n`, the state model. | ~150 lines |
| `decisions/000N-*.md` | 5 ADRs, above. Never edited after writing. | 5 × ~40 lines |
| `specs/open.md` | Known gaps. "A state, not a log" — items are deleted when fixed. | ~30 lines |
| `AGENTS.md` | Commands, testing rules, style, boundaries. | ~70 lines |

**The budget is the point.** Dan Vega, solo dev, learned it this way: *"a
single-file plan only works if it stays short."* When `PRODUCT.md` passes ~200
lines, that's the signal you've started re-describing code.

---

## What I'd be deleting, and what I'd lose

Honest accounting. **3,180 lines of group A go.** If a group-A spec contains a
reasoning you can't reconstruct from the tests, it belongs in `PRODUCT.md`
Decisions — I'd move it rather than delete it. That's the safety valve.

Two things group A genuinely cannot replace, and I'd carry both:

1. **Non-functional policy.** "Don't send browsing hostnames anywhere" is not in
   any test's name. It goes to `PRODUCT.md` as a stated invariant.
2. **Rejected alternatives.** "Why not just use `contenteditable`?" — only the
   spec knows that was considered. Goes to an ADR.

---

## Measured cost of keeping them

Eberhardt ran spec-kit on a real hobby app:

| | Agent time | Markdown produced | His review time |
|---|---|---|---|
| spec-kit | 33m 30s | **2,577 lines** | **3.5 hrs** |
| his normal approach | 8m | 0 | 15 min |

> "**Ultimately a lot of time spent reviewing markdown... I didn't see any
> qualitative benefit to justify the overhead.**"
> "**I'm a lot more productive without SDD, around ten times faster.**"

Your 5,786 lines are the same shape.

---

## Decision

**Option 1 — full collapse.** 47 → 4 files, ~440 lines. Requires group C to get
tests first (they're already required by your 80% rule).

**Option 2 — phased.** Do group D (5 ADRs) and group B (into AGENTS.md) now,
leave group A alone. Deletion deferred. Lower risk, most of the benefit is not
realised — the 3,180 stale-able lines stay.

**Option 3 — group C only.** Keep everything, just add the 4 untested components.
Ignores the problem.

I'd do **Option 1**, but **Option 2 is legitimate** if you'd rather not delete
5,786 lines in one go — in which case I'd delete group B and D now (1,266 lines,
zero ambiguity) and revisit group A once the coverage work is done and we can see
whether the tests really did replace them.