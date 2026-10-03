# Review dispositions

How to use this file. It is the mechanism that ends a review spiral.

## The problem it solves

A review round produces findings. Some are real and get fixed. Some are wrong and
get rejected. **Without writing the rejections down, the next round re-raises the
same rejected finding**, because the next reviewer has no memory of the last one.
That is how this repo got to five review rounds on one change, several of them
resolving findings that were themselves false claims.

So: every finding, accepted or not, gets an entry here before the next round.

## Rules

1. **Never delete a rejected finding.** It stays, with its reason. A finding that
   vanishes from the record is how the same argument gets re-litigated.
2. **Re-raise only with new evidence** — a specific case the rejection did not
   consider. "I still believe this" is not evidence.
3. **A rejected finding needs a reason that names the evidence**, not a
   disposition. "Author doesn't want it" is not a reason; "the spec explicitly
   permits it, at specs/x.spec.md#L42" is.
4. **Two rounds is the cap.** After round 2, the change is decomposed or a human
   decides. The signal that a change needs two rounds is that the change is wrong,
   not that the review is thorough.

## Template

Copy this block per change.

```markdown
# <sha> — <subject>

Round 1 · reviewed <date>

## Findings

### BLOCKER

- `src/foo.ts:42` — <defect>
  - Violates: AC-3 (specs/bar.spec.md)
  - Disposition: FIXED in <sha> | REJECTED — <reason, naming evidence>

### MAJOR

- <file:line> — <defect>
  - Disposition: FIXED in <sha> | REJECTED — <reason>

### MINOR

- <file:line> — <defect>
  - Disposition: FIXED in <sha> | REJECTED — <reason> | DEFERRED — <issue link>

## Spec gaps (not blockers)

- <what ought to be specified>

## Rejected

Findings dismissed in this round, with reasons. Copy forward to every later round.

- <finding> — <reason>
```

## Round history

Append a section per round. Never rewrite an earlier one.

```markdown
## Round 2 · reviewed <date>

### Carried-forward rejections still closed

- <finding> — still rejected (no new evidence offered)

### New findings

- <file:line> — <defect> — FIXED in <sha>

### Round cap reached

Two rounds spent on this change. Recommend decomposition or human review.
```
