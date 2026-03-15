/**
 * Review prompt eligibility, state management, and store URL resolution.
 *
 * Determines when to ask the user to rate Clipio on the browser extension store.
 * Targets engaged users (installed for ≥7 days, ≥20 snippet expansions) while
 * suppressing the prompt when the extension has recently encountered errors —
 * avoiding negative reviews caused by bugs.
 *
 * spec: review-prompt.spec.md
 */

import {
  reviewPromptStateItem,
  reviewPromptSnoozedUntilItem,
  extensionInstalledAtItem,
  totalSnippetInsertionsItem,
  lastSentryErrorAtItem,
  type ReviewPromptState,
} from "~/storage/items";
import {
  REVIEW_MIN_DAYS,
  REVIEW_MIN_INSERTIONS,
  REVIEW_ERROR_SNOOZE_HOURS,
} from "~/config/constants";

// Re-export the type so consumers can import it from this module
export type { ReviewPromptState };

// ---------------------------------------------------------------------------
// Eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns true when all eligibility conditions are met and the review prompt
 * should be shown.
 *
 * Conditions (all must pass):
 *  1. reviewPromptState === "pending"
 *  2. reviewPromptSnoozedUntil is null or in the past
 *  3. extensionInstalledAt is set and ≥ REVIEW_MIN_DAYS ago
 *  4. totalSnippetInsertions ≥ REVIEW_MIN_INSERTIONS
 *  5. lastSentryErrorAt is null or older than REVIEW_ERROR_SNOOZE_HOURS
 *     (when condition 5 fails, also snoozes to skip the next alarm tick)
 *
 * Never throws — returns false on any storage read failure.
 *
 * spec: review-prompt.spec.md#eligibility
 */
export async function shouldShowReviewPrompt(): Promise<boolean> {
  try {
    // Condition 1: state must be "pending"
    const state = await reviewPromptStateItem.getValue();
    if (state !== "pending") return false;

    // Condition 2: not currently snoozed
    const snoozedUntil = await reviewPromptSnoozedUntilItem.getValue();
    if (snoozedUntil && Date.now() < new Date(snoozedUntil).getTime()) {
      return false;
    }

    // Condition 3: installed for at least REVIEW_MIN_DAYS
    const installedAt = await extensionInstalledAtItem.getValue();
    if (!installedAt) return false;
    const minAgeMs = REVIEW_MIN_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(installedAt).getTime() < minAgeMs) return false;

    // Condition 4: minimum snippet insertions
    const insertions = await totalSnippetInsertionsItem.getValue();
    if (insertions < REVIEW_MIN_INSERTIONS) return false;

    // Condition 5: no recent Sentry errors
    const lastErrorAt = await lastSentryErrorAtItem.getValue();
    if (lastErrorAt) {
      const errorAgeMs = Date.now() - new Date(lastErrorAt).getTime();
      const errorWindowMs = REVIEW_ERROR_SNOOZE_HOURS * 60 * 60 * 1000;
      if (errorAgeMs < errorWindowMs) {
        // Snooze so the next alarm tick skips condition 2 without re-reading errors
        snoozeReviewPrompt(REVIEW_ERROR_SNOOZE_HOURS).catch(() => {});
        return false;
      }
    }

    return true;
  } catch {
    // Never throw — the background alarm handler depends on this guarantee
    return false;
  }
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Transition the review prompt to a new lifecycle state.
 * Once "dismissed" or "rated", the prompt is permanently suppressed.
 *
 * spec: review-prompt.spec.md#state-helpers
 */
export async function setReviewPromptState(
  state: ReviewPromptState
): Promise<void> {
  await reviewPromptStateItem.setValue(state);
}

/**
 * Snooze the review prompt for the given number of hours.
 * Sets reviewPromptSnoozedUntil to now + hours.
 *
 * spec: review-prompt.spec.md#state-helpers
 */
export async function snoozeReviewPrompt(hours: number): Promise<void> {
  const snoozedUntil = new Date(
    Date.now() + hours * 60 * 60 * 1000
  ).toISOString();
  await reviewPromptSnoozedUntilItem.setValue(snoozedUntil);
}

// ---------------------------------------------------------------------------
// Store URL resolution
// ---------------------------------------------------------------------------

/**
 * Returns the URL to the extension's review page on the appropriate store.
 *
 * - Firefox → Firefox Add-ons review URL
 * - Chrome/Edge/etc → Chrome Web Store review URL (uses browser.runtime.id)
 * - Fallback (browser unavailable) → Chrome Web Store homepage
 *
 * spec: review-prompt.spec.md#store-url-resolution
 */
export function getStoreReviewUrl(): string {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Firefox")
    ) {
      return "https://addons.mozilla.org/firefox/addon/clipio/";
    }
    const id = browser.runtime.id;
    return `https://chromewebstore.google.com/detail/${id}/reviews`;
  } catch {
    return "https://chromewebstore.google.com/";
  }
}
