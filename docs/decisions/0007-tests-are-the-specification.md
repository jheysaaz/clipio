# 0007 — The tests are the specification

**Status:** accepted · **Date:** 2026-10-03

## Context

The repo carried **47 spec files, 5,786 lines**, against 25,351 lines of source.
A drift check found the category was the problem, not the organisation:

- **36 of 47 already had a matching unit test.**
- **7 specs described code that no longer existed** — including
  `template.spec.md`, documenting a module absent from all of git history, and
  `messages.spec.md`, documenting a `MessageMap` API never built.

So the specs were not providing information the codebase lacked. They were a
second copy of it, drifting.

**Research findings behind the decision:**

- **Kent Beck, *Canon TDD*** — the first step of TDD is a *Test List*: "list all
  the expected variants in the new behavior... This is analysis, but
  **behavioral** analysis." The tests that follow **are** that list, made
  executable.
- **Dan North (BDD)** — the acceptance criteria *are* the specification; there
  is no second document. He also states that for a team of only programmers,
  skip BDD — the ceremony exists to communicate to *others*.
- **Michael Nygard (who invented ADRs)** — "Large documents are never kept up to
  date." 46 of the 47 carried a change-history table that `git log` already has.
- **Eberhardt**, measuring spec-kit on a real app: 2,577 lines of markdown and
  3.5 hours of review, versus 8 and 15 minutes for his normal approach. His
  verdict: "**I'm a lot more productive without SDD, around ten times faster.**"

## Decision

**A test that can fail is the specification. Prose describing behaviour that a
test already pins is deleted.**

Replaced by four kinds of document, each with a budget:

| Document | Holds | Why it cannot be a test |
|---|---|---|
| `README.md` | What Clipio is for, user jobs, non-goals | Intent is not behaviour |
| `docs/architecture.md` | Entrypoints, storage layers, key choices | Structure is not behaviour |
| `docs/decisions/` | ADRs, only where a decision was **reversed** | `git log` records the change, never the reason |
| `docs/open.md` | Known gaps. "A state, not a log" | What is wrong *right now* |

The test-suite rules went into `AGENTS.md`, where an agent actually reads them.

## Alternatives considered

**Keep the specs and add a staleness checker.** A checker that must parse prose to
know whether it still matches the code is more machinery than the specs are
worth, and it reports "probably stale" — which is the state they were already in.

**Keep only the 7 specs describing untested code.** Honest at the time, but those
components were since given real tests, and a spec for code that now has a test
is a group-A file with extra steps.

## Consequences

**Reasoning has to go somewhere real.** A rejected alternative or a non-functional
invariant is not recoverable from a test — `markdown.test.ts` will not tell you
that `contenteditable` was considered and why it lost. Those become ADRs. That
is why [0008](0008-bucket-hostnames-never-send-raw.md) exists.

Spec-file count is not a proxy for rigour here, and adding one back needs a
reason that survives the question *"which failing test would this prevent?"*

## Revisit when

A spec file appears alongside a passing test for the same behaviour. That is the
whole failure mode, restated.