# Module: Review Prompt

> Source: `src/lib/review-prompt.ts`
> Coverage target: 90%

## Purpose

Determines when to show the app review prompt to users.

## Scope

**In scope:** Review prompt eligibility logic.
**Out of scope:** Prompt UI, app store integration.

---

## `shouldShowReviewPrompt(): Promise<boolean>`

**Behavior:**

- Returns `true` if: user has ≥5 snippets AND ≥10 expansions AND hasn't been prompted in 30 days.
- Resets prompt timer on dismissal.

---

## Error Handling

- Returns `false` on storage errors.
- Does not throw.

---

## Dependencies

- Storage for snippet count, expansion count, last prompt timestamp.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |