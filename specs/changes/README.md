# Change requests

A change request is the unit of work for SPEC → CODE → REVIEW. One per logical
change, written **before** the code, and it is what the reviewer checks against.

## Why this exists

The workflow in `AGENTS.md` has always said "write a spec first". Measured over
the last 30 commits, that did not happen:

- **20 of 30** changed `src/` and `specs/` in the same commit.
- Only **4 of 60** touched specs alone.

So the spec was being written as _documentation of_ the change rather than
_before_ it. That is why review step 4 — "check spec adherence" — had nothing
authoritative to check against, and why the reviewer started inventing
requirements. Five-plus review rounds on one change, several resolving findings
that were themselves false claims, is the predictable result.

Writing the file first is not a discipline problem, it is a sequencing problem.
This directory makes the sequencing visible in `git log`.

## When one is required

Required for any change that alters observable behaviour. Not required for a
pure refactor with no behavioural difference, a dependency bump, or a docs fix —
those are reviewed against the existing specs.

## Template

```markdown
# <slug>

> Status: OPEN | SHIPPED | KNOWN-GAP
> Author: —
> Created: YYYY-MM-DD

## Problem

What breaks today, or what is missing. One or two sentences. If there is no
problem, there may be no change request needed.

## Change

What will be different afterwards.

## Acceptance criteria

Numbered. These are the definition of done and the reviewer's only authority.

- AC-1 <testable outcome>
- AC-2 <testable outcome, including the negative case>

Every criterion must be checkable. "Works correctly" is not a criterion;
"`sanitizeUrl('JaVaScRiPt:alert(1)')` returns `''`" is.

## Edge cases

- <case and the required behaviour>
- <failure mode and the required behaviour>

## Verification

- [ ] `pnpm verify` green
- [ ] `pnpm verify:full` green (if user-facing)
- [ ] Every AC above is asserted by a named test
- [ ] Coverage thresholds still met

## Disposition

<!-- Fill in when closing. -->

- SHIPPED in <sha> on <date>
- KNOWN-GAP: <what is not done> · tracked by <issue>
```

## Status values

| Status      | Meaning                                            |
| ----------- | -------------------------------------------------- |
| `OPEN`      | In progress.                                       |
| `SHIPPED`   | Merged, every AC met.                              |
| `KNOWN-GAP` | Deliberately not done. **Requires an issue link.** |

`KNOWN-GAP` exists so "we decided not to do this" is distinguishable from "we
forgot". Nineteen unchecked `- [ ]` acceptance criteria were sitting across the
existing specs, mixing not-started, not-solvable, and done-but-unticked. A box
cannot carry that distinction; a status can.

## Example

A real one is worth more than the template — see
[`coverage-honesty.spec.md`](./coverage-honesty.spec.md), which was written to
fix three gates that were green while measuring less than they claimed.
