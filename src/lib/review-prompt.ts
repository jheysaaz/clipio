/**
 * Review prompt eligibility, state management, and store URL resolution.
 *
 * Determines when to ask the user to rate Clipio on the browser extension store.
 * Targets engaged users (installed for ≥7 days, ≥20 snippet expansions) while
 * suppressing the prompt when the extension has recently encountered errors —
 * avoiding negative reviews caused by bugs.
 *
 */

import {
  reviewPromptStateItem,
  reviewPromptSnoozedUntilItem,
  extensionInstalledAtItem,
  totalSnippetInsertionsItem,
  lastSentryErrorAtItem,
  type ReviewPromptState,
} from "@/storage/items";
import {
  REVIEW_MIN_DAYS,
  REVIEW_MIN_INSERTIONS,
  REVIEW_ERROR_SNOOZE_HOURS,
} from "@/config/constants";

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
// Banner visibility (options page)
// ---------------------------------------------------------------------------

/**
 * Returns true when the options page should render the review banner.
 *
 * This asks a DIFFERENT question from shouldShowReviewPrompt, and the two are
 * not interchangeable:
 *
 *   shouldShowReviewPrompt()  "is this user eligible to be prompted at all?"
 *                             Requires state === "pending". Called by the
 *                             background alarm, which writes "shown" on success.
 *
 *   shouldShowReviewBanner()  "has this user already been prompted, and not
 *                             acted on it?" Requires state === "shown".
 *                             Called by the options page.
 *
 * The lifecycle is one-way (pending -> shown -> dismissed | rated), so these two
 * read opposite ends of it. Substituting one for the other is a bug: calling
 * shouldShowReviewPrompt() from the options page would return false every time,
 * because by the time the page can ask, the state is already "shown".
 *
 * This previously lived as an inline copy inside OptionsPage.tsx. Two copies of
 * one policy is how they drift, so it lives here now.
 *
 * Never throws.
 */
export async function shouldShowReviewBanner(): Promise<boolean> {
  try {
    const state = await reviewPromptStateItem.getValue();
    if (state !== "shown") return false;

    const lastErrorAt = await lastSentryErrorAtItem.getValue();
    if (lastErrorAt) {
      const errorAgeMs = Date.now() - new Date(lastErrorAt).getTime();
      const twentyFourHoursMs = REVIEW_ERROR_SNOOZE_HOURS * 60 * 60 * 1000;
      if (errorAgeMs < twentyFourHoursMs) return false;
    }
    return true;
  } catch {
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
 */
/**
 * Whether this is a Chromium-based browser.
 *
 * Chrome and Edge both expose a Chrome Web Store listing; Firefox does not, so
 * the "leave a review" action is hidden there rather than sending the user to a
 * store page that does not exist.
 *
 * Exported separately from `getStoreReviewUrl`, which still needs a Firefox
 * branch for the AMO listing used by the review prompt.
 */
export function isChromiumBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return !/Firefox|FxiOS|EdgiOS/i.test(navigator.userAgent);
}

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
