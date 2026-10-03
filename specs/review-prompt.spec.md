# Module: Review Prompt

> Source: `src/lib/review-prompt.ts`
> Coverage target: 90%

## Purpose

Determines when to show the app review prompt to users.

## Scope

**In scope:** Review prompt eligibility logic.
**Out of scope:** Prompt UI, app store integration.

---

## Eligibility

### Condition 1 — state is pending

`reviewPromptState === "pending"`

### Condition 2 — not snoozed

`reviewPromptSnoozedUntil` is null or in the past

### Condition 3 — minimum install age

`extensionInstalledAt` is set and at least `REVIEW_MIN_DAYS` (7) ago

### Condition 4 — minimum usage

`totalSnippetInsertions` is at least `REVIEW_MIN_INSERTIONS` (20)

### Condition 5 — no recent errors

`lastSentryErrorAt` is null or older than `REVIEW_ERROR_SNOOZE_HOURS` (24) — and
failing this also snoozes, to skip the next alarm tick

## `shouldShowReviewPrompt(): Promise<boolean>`

**Behavior:**

- Returns `true` only when **all five** conditions above pass.
- **There is no snippet-count condition.** An earlier revision of this spec claimed "≥5 snippets
  AND ≥10 expansions AND hasn't been prompted in 30 days"; the implementation checks none of
  those three numbers, and uses 7 days and 20 insertions instead.
- **Dismissal does not reset a timer.** `setReviewPromptState` moves the state to `"dismissed"`,
  which permanently suppresses the prompt. The earlier "resets prompt timer on dismissal" claim
  described behaviour that does not exist.
- Never throws: any storage read failure returns `false`.

---

## Resilience

Any storage read failure resolves to `false` rather than rejecting. This is the
guarantee `shouldShowReviewPrompt` makes, and it is asserted directly rather
than inferred from the happy path.

## Store URL resolution

The review link resolves to the Chrome Web Store on Chromium and is absent on
Firefox, where the store does not exist. The e2e suite runs on Chromium, so it
asserts presence there.

## Options page banner

The banner is rendered on the options page when eligibility passes. Its
visibility, its dismissal path, and the store link are covered by
`e2e/options.spec.ts`.

## State helpers

`getReviewPromptState` and `snoozeReviewPrompt` read and write the same storage
keys that `shouldShowReviewPrompt` reads, so a snooze written by one is visible
to the other within the same tick.

## `setReviewPromptState()`

Moves state to `"dismissed"` (permanently suppressing the prompt) or back to
`"pending"`. Dismissal does not reset any timer — see the note above.

## `snoozeReviewPrompt()`

Pushes `reviewPromptSnoozedUntil` forward. A snooze suppresses the prompt until
that instant; it does not change `reviewPromptState`, so a later dismissal and a
later snooze compose rather than overwrite each other.

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
