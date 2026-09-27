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

- Returns `true` only when **all five** conditions pass:
  1. `reviewPromptState === "pending"`
  2. `reviewPromptSnoozedUntil` is null or in the past
  3. `extensionInstalledAt` is set and at least `REVIEW_MIN_DAYS` (7) ago
  4. `totalSnippetInsertions` is at least `REVIEW_MIN_INSERTIONS` (20)
  5. `lastSentryErrorAt` is null or older than `REVIEW_ERROR_SNOOZE_HOURS` (24) — and
     failing this also snoozes, to skip the next alarm tick
- **There is no snippet-count condition.** An earlier revision of this spec claimed "≥5 snippets
  AND ≥10 expansions AND hasn't been prompted in 30 days"; the implementation checks none of
  those three numbers, and uses 7 days and 20 insertions instead.
- **Dismissal does not reset a timer.** `setReviewPromptState` moves the state to `"dismissed"`,
  which permanently suppresses the prompt. The earlier "resets prompt timer on dismissal" claim
  described behaviour that does not exist.
- Never throws: any storage read failure returns `false`.

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
