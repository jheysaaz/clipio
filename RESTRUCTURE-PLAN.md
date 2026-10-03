# Restructure Plan

> Working document. Updated as I go. This file is the source of truth for
> progress — if you read one thing, read this.

## Status legend

`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked / needs your call

---

## Your 16 asks

| # | Ask | Status | Notes |
|---|-----|--------|-------|
| 1 | Drop what I said was droppable | `[x]` | Done in `da99e91`. Stryker, flake gate, review machinery, 2 spec files |
| 2 | Rethink E2E — reserve for critical/high-priority only | `[~]` | Answers received. Starting the audit of which tests need a real browser. |
| 3 | Simplify tests + one flat 80% coverage for all code | `[ ]` | 80% everywhere, no exclusions without asking you |
| 4 | Slim AGENTS.md to essentials | `[ ]` | 502 lines is far too long |
| 5 | Rethink specs structure; research SDD + TDD | `[ ]` | Needs research before I touch anything |
| 6 | Update all dependencies to latest, incl. majors | `[ ]` | Always latest. Verify after each change. |
| 7 | Drop unnecessary scripts | `[~]` | 9 remain (4 were yours). Still to review the 3 checks |
| 8 | Restructure code tree, keep WXT guidelines | `[ ]` | WXT layout is a hard constraint |
| 9 | Remove root files not needed for a solo project | `[ ]` | |
| 10 | Do we need that many tsconfigs? | `[ ]` | I added 1; there were 3 |
| 11 | Don't ship opencode / local settings | `[x]` | `.opencode/agent/` gone; your `plans/` kept untouched |
| 12 | Remove TEST_AUDIT.md | `[x]` | Done |
| 13 | Remove unneeded comments; hunt dead code deeply | `[ ]` | Full-tree audit |
| 14 | Live progress feedback | `[x]` | This file, updated per step |
| 15 | Track the whole plan here | `[x]` | Done |
| 16 | Have fun / ask anything | `[ ]` | Questions at the bottom |

---

## Order of operations

Chosen so each step leaves the repo green. Risky work is isolated.

1. **Track the plan** (done)
2. **Ask clarifying questions** — items 2 and 5 change everything downstream
3. **Research SDD/TDD** — item 5, needs external input
4. **Remove what we're dropping** — items 1, 7, 11, 12 (pure deletion, low risk)
5. **Root + tsconfig cleanup** — items 9, 10
6. **Dependencies** — item 6 (isolated, verifiable)
7. **E2E rethink** — item 2 (biggest runtime win)
8. **Coverage simplify** — item 3
9. **Specs restructure** — item 5 (after research)
10. **Dead code + comments** — item 13
11. **Code tree** — item 8 (last, touches everything)
12. **AGENTS.md rewrite** — item 4 (last, documents the final state)

---

## Decisions I need from you

### Q1 — E2E scope (item 2) — ANSWERED

**Your answer:** snippet insert is the main critical path. Then basic CRUD, then
data surviving restart. And: much of the current E2E is really unit-testing, and
should move because it is faster and cheaper.

### E2E audit — every one of the 153 classified

**Keep in E2E — these need a real browser.** 24 tests, 4 files.

| What | Why it needs a browser |
|---|---|
| 12 × insert/expand | The content script must actually be injected by the extension into a real page. No amount of happy-dom proves the injection wiring, the debounce timing, or caret position against real layout. |
| 4 × CRUD + reload | Chrome `storage.sync` behaviour under a real extension origin. |
| 3 × persists across restart | Service worker lifecycle + storage durability across a browser restart. |
| 5 × messaging relay | `runtime.sendMessage` between genuinely separate JS contexts. |

**Move to unit tests — real behaviour, wrong tool.** ~85 tests.

| From | To | Note |
|---|---|---|
| `options.spec.ts` 14–18 (font/theme/confetti) | `src/lib/ui-font.test.ts` | Already 12 tests exist. These E2E ones re-prove the same rules in 100x the time. |
| `options.spec.ts` 34–41 (review banner) | `src/lib/review-prompt.test.ts` | **Already 37 unit tests cover this exact logic.** The E2E set is near-total duplication. |
| `options.spec.ts` 23–26 (update banner, ping) | `src/lib/update-checker.test.ts` | Already 70 unit tests. |
| `options.spec.ts` 10–13 (export/import) | `src/lib/exporters/*`, `importers/*` | All have unit tests. Import parsing does not need Chrome. |
| `popup.spec.ts` 1–5, 9–10 | component + unit | Rendering and filtering, not extension APIs. |
| `blocked-sites.spec.ts` 8 | `src/lib/blocked-sites.test.ts` | Pure hostname matching. |
| `image-gif.spec.ts` 4–5 | `src/lib/snippet-preview-ui` | Already covered. |

**Delete — asserting nothing valuable.** ~44 tests.

`options.spec.ts` 42–44 (axe scans — axe-core runs fine in jsdom/happy-dom),
`manual-qa-page.spec.ts` (1 test, checks an HTML file has inputs),
`options.spec.ts` 8 ("does not repeat its own heading" — CSS trivia).

**Target: 153 -> ~25 E2E tests, 7min -> under 90s.** Unit suite grows to absorb
the moved work and stays ~7–10s.

### Q2 — Coverage (item 3) — ANSWERED

**Your answer:** 80% across all code is non-negotiable. Write the tests. If I
genuinely believe a file should not be held to 80%, I must ask you first, with
real reasons.

**So:** no exclusions without asking. Four components currently at 0%
(`ConfirmDialog`, `ImportWizard`, `NewSnippetView`, `SnippetDetailView`) get
**real tests**, not a written-reason exclusion. I will interrupt you only if I
hit a genuine case, and I will bring reasons.

### Q3 — Local vs shipped files (item 11)

You said don't ship opencode settings or local files.

I'd interpret that as: `.opencode/` stays on your machine, never committed. But
it's currently the reviewer agent definition, which item 1 drops anyway.

**Question:** do you want any agent instructions at all, or would you rather I
just leave `AGENTS.md` as the single source?

### Q4 — Dependency majors (item 6) — ANSWERED

**Your answer:** always latest. If we have WXT 0.20.2 and 0.21.1 exists, go to
0.21.1.

**So:** `latest` for every dependency, majors included. Verify compile + tests +
build after each change so a break is attributable to one package.

### Q5 — Specs (item 5) — still open

The research came back (see above) and recommends 47 files -> 4. I need your
yes before deleting 5,739 lines of your writing.

**Question:** go ahead with the 4-file structure?

### Q6 — Store credentials

You said these will be configured in another day. Noted — not my problem to solve,
and it is **separate** from the v1.6.0 failure (that died in E2E, before
`Submit to Stores` ever ran). I will leave the publish workflow's secret names
untouched so your setup matches it.

---

---

## Research finding on specs (item 5) — this changed my mind

I had assumed the problem was "too many specs, organise them better." The
research says the problem is **the category of document**. Summary:

**Kent Beck, `Canon TDD`** — the first step of TDD is a *Test List*: "list all the
expected variants in the new behavior... This is analysis, but **behavioral
analysis**." He names the mistake of turning every item into a test up front.

**Dan North (BDD)** — the acceptance criteria *are* the specification. There is no
second document. He also says explicitly: for a team of only programmers, skip
BDD, the ceremony is for *communicating* to others.

**The tests are the module documentation.** What a spec file says about
`markdownToHtml` is already said, more precisely, by `markdown.test.ts`.

**The measured cost.** Eberhardt ran spec-kit on a real app: 2,577 lines of
markdown, 3.5 hours of review, versus 8 minutes and 15 minutes for his normal
approach. His verdict: "**I'm a lot more productive without SDD, around ten times
faster.**"

**Why change-history tables are the wrong tool.** Nygard (who invented ADRs):
"Large documents are never kept up to date." 46 of your 47 specs carry one. `git
log` already knows that.

### Proposed replacement: 47 files -> 4

| File | Holds | Why |
|---|---|---|
| `PRODUCT.md` | What Clipio is for, user jobs, non-goals, decisions with reasons | The *why*. Code cannot hold this. |
| `ARCHITECTURE.md` | Entrypoints, storage layers, key choices | The *how*. Currently scattered. |
| `decisions/` | ~5 ADRs, only for decisions that reversed | e.g. why `retries: 0`, why Plate.js |
| `specs/open.md` | Known gaps and risks. "A state, not a log" | What is wrong right now |

Everything else is deleted, because the tests already say it.

**This is the one change I will not make without your explicit yes.** It deletes
5,739 lines of your writing. See Q5.

---

## Log

Entries appended as work happens, so context is never lost.

- **Start:** repo on `6b10f91`, working tree clean apart from your untracked
  `specs/changes/dependency-major-upgrades.md`, which I am leaving alone.
- **`da99e91`:** removed Stryker, flake gate, review machinery, TEST_AUDIT.md and
  2 spec files. `pnpm verify` 9/9 green, compile clean, 1712 tests pass.