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
| 2 | Rethink E2E — reserve for critical/high-priority only | `[ ]` | Currently 147 tests / 7 min. Biggest single win available. |
| 3 | Simplify tests + one flat 80% coverage for all code | `[ ]` | Kill the per-module + per-directory threshold ladder |
| 4 | Slim AGENTS.md to essentials | `[ ]` | 502 lines is far too long |
| 5 | Rethink specs structure; research SDD + TDD | `[ ]` | Needs research before I touch anything |
| 6 | Update all dependencies to latest, incl. majors | `[ ]` | Must not break the build; verify at each step |
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

### Q1 — E2E scope (item 2)

E2E is ~7 minutes and 147 tests. You want it reserved for critical paths.

**My proposal:** keep only what a user would notice breaking:

- Insert a snippet into a page (the core loop)
- Create / edit / delete a snippet
- Data survives a browser restart
- Settings change and persist

Target: **15–25 tests, under 90 seconds.** Everything else moves to unit tests,
which run in ~7 seconds.

**Question:** which features are *most* important to you? Anything you'd be
upset to ship broken?

### Q2 — Coverage (item 3)

You want a flat 80% for all code.

One thing you should know before deciding: the components layer currently sits
at ~3%, because four components have no tests at all. Flat 80% across *everything*
means writing real tests for those, or excluding them with a written reason.

**Question:** flat 80% on everything, or 80% on everything except the four
untested components (excluded with a written reason until they have tests)?

### Q3 — Local vs shipped files (item 11)

You said don't ship opencode settings or local files.

I'd interpret that as: `.opencode/` stays on your machine, never committed. But
it's currently the reviewer agent definition, which item 1 drops anyway.

**Question:** do you want any agent instructions at all, or would you rather I
just leave `AGENTS.md` as the single source?

### Q4 — Dependency majors (item 6)

Updating majors will change behaviour, not just versions. WXT 0.20 → newer, React
19 → newer, Vitest 4 → newer.

**Question:** do you want me to go all the way to latest majors, or stay on
current majors and only patch/minor? I'll verify the build after every step
either way, but full majors is a longer job.

### Q5 — Specs (item 5)

I'm researching this before I touch anything. Rough direction: specs describe
*what the system does*, tests verify *the rules*, and you write the spec for a
feature once — not per-change.

**Question:** do you actually enjoy writing specs, or is it friction? That
changes whether the answer is "one spec per module" or "a short design note per
feature".

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