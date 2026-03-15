# Review Prompt — Behavioral Specification

**Module:** `src/lib/review-prompt.ts`  
**Coverage target:** 90%

---

## Overview

The review prompt asks users to rate Clipio on the appropriate browser extension store
after they have used the extension for a meaningful period. The goal is to collect
positive reviews by targeting engaged, satisfied users — and to avoid negative reviews
by suppressing the prompt when errors have been detected.

The prompt has two surfaces:

1. A native browser notification (fired from the background service worker via alarm)
2. A dismissible banner in the Options page (reads the same state)

---

## State Machine

The prompt lifecycle is stored in `local:reviewPromptState` as a `ReviewPromptState`:

```
"pending" → "shown" → "dismissed"  (permanent: never ask again)
                    → "rated"       (permanent: never ask again)
```

- **pending**: initial state; eligibility is checked on each alarm tick
- **shown**: background has verified eligibility and fired the notification; banner becomes visible in Options
- **dismissed**: user closed the prompt without visiting the store
- **rated**: user clicked the "Rate" link; prompt is permanently retired

---

## Eligibility (`shouldShowReviewPrompt`)

`shouldShowReviewPrompt()` returns `true` only when ALL of the following conditions pass.
Each failing condition MUST return `false` immediately without checking further conditions.

### Condition 1 — State is pending

MUST return `false` when `reviewPromptState` is `"shown"`, `"dismissed"`, or `"rated"`.

### Condition 2 — Not snoozed

MUST return `false` when `reviewPromptSnoozedUntil` is set and `Date.now() < snoozedUntil`.

### Condition 3 — Minimum install age

MUST return `false` when:

- `extensionInstalledAt` is `null`, or
- the difference between `Date.now()` and `extensionInstalledAt` is less than
  `REVIEW_MIN_DAYS * 24 * 60 * 60 * 1000` milliseconds (7 days)

### Condition 4 — Minimum usage

MUST return `false` when `totalSnippetInsertions < REVIEW_MIN_INSERTIONS` (20).

### Condition 5 — No recent errors

MUST return `false` when `lastSentryErrorAt` is set and the elapsed time since that
timestamp is less than `REVIEW_ERROR_SNOOZE_HOURS * 60 * 60 * 1000` milliseconds (24 hours).

When condition 5 fails, `shouldShowReviewPrompt` MUST also call `snoozeReviewPrompt(REVIEW_ERROR_SNOOZE_HOURS)`
as a fire-and-forget side-effect before returning `false`. This advances the snooze window
so condition 2 catches it on the next alarm tick without re-reading `lastSentryErrorAt`.

### Resilience

MUST return `false` (never throw) when any storage read operation rejects.
The background alarm handler relies on this guarantee.

---

## State Helpers

### `setReviewPromptState(state)`

MUST write `state` to `reviewPromptStateItem`.

### `snoozeReviewPrompt(hours)`

MUST write `new Date(Date.now() + hours * 3_600_000).toISOString()` to
`reviewPromptSnoozedUntilItem`.

---

## Store URL Resolution (`getStoreReviewUrl`)

MUST return a URL string pointing to the extension's review page on the
appropriate store for the current browser.

- When `navigator.userAgent` contains `"Firefox"`, MUST return the Firefox Add-ons review URL:
  `https://addons.mozilla.org/firefox/addon/clipio/`
- Otherwise (Chrome, Edge, etc.), MUST return the Chrome Web Store review URL:
  `https://chromewebstore.google.com/detail/{extensionId}/reviews`
  where `{extensionId}` is `browser.runtime.id`.
- When `browser.runtime.id` is unavailable (e.g. unit test environment), MUST return a
  safe fallback URL: `https://chromewebstore.google.com/`

---

## Integration Points (non-testable here, documented for completeness)

- **Background**: On `clipio-review-check` alarm, calls `shouldShowReviewPrompt()`. If `true`,
  calls `setReviewPromptState("shown")` then `browser.notifications.create("clipio-review", …)`.
- **Background (notification click)**: When `notificationId === "clipio-review"`, calls
  `getStoreReviewUrl()`, opens a new tab, then calls `setReviewPromptState("rated")`.
- **Options page**: Reads `reviewPromptStateItem` on mount. If `"shown"` and no recent error,
  renders the review banner. "Rate now" → `setReviewPromptState("rated")`. Dismiss → `setReviewPromptState("dismissed")`.
