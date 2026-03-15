/**
 * Tests for src/lib/review-prompt.ts
 * spec: specs/review-prompt.spec.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  shouldShowReviewPrompt,
  setReviewPromptState,
  snoozeReviewPrompt,
  getStoreReviewUrl,
} from "./review-prompt";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReviewPromptStateItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => "pending" as string),
  setValue: vi.fn(async () => {}),
}));

const mockReviewPromptSnoozedUntilItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => null as string | null),
  setValue: vi.fn(async () => {}),
}));

const mockExtensionInstalledAtItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => null as string | null),
  setValue: vi.fn(async () => {}),
}));

const mockTotalSnippetInsertionsItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => 0),
  setValue: vi.fn(async () => {}),
}));

const mockLastSentryErrorAtItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => null as string | null),
  setValue: vi.fn(async () => {}),
}));

vi.mock("~/storage/items", () => ({
  reviewPromptStateItem: mockReviewPromptStateItem,
  reviewPromptSnoozedUntilItem: mockReviewPromptSnoozedUntilItem,
  extensionInstalledAtItem: mockExtensionInstalledAtItem,
  totalSnippetInsertionsItem: mockTotalSnippetInsertionsItem,
  lastSentryErrorAtItem: mockLastSentryErrorAtItem,
  // Other items not used by review-prompt
  giphyApiKeyItem: { getValue: vi.fn(), setValue: vi.fn() },
  onboardingCompletedItem: { getValue: vi.fn(), setValue: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an ISO timestamp that is `days` days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Returns an ISO timestamp that is `hours` hours in the past. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Returns an ISO timestamp that is `hours` hours in the future. */
function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/** Sets up storage mocks to pass all 5 eligibility conditions. */
function setupEligibleState() {
  mockReviewPromptStateItem.getValue.mockResolvedValue("pending");
  mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(null);
  mockExtensionInstalledAtItem.getValue.mockResolvedValue(daysAgo(8));
  mockTotalSnippetInsertionsItem.getValue.mockResolvedValue(25);
  mockLastSentryErrorAtItem.getValue.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — Condition 1: state is pending
// spec: review-prompt.spec.md#condition-1--state-is-pending
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — Condition 1: state", () => {
  it("returns false when state is 'shown'", async () => {
    // spec: review-prompt.spec.md#condition-1--state-is-pending
    mockReviewPromptStateItem.getValue.mockResolvedValue("shown");
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("returns false when state is 'dismissed'", async () => {
    // spec: review-prompt.spec.md#condition-1--state-is-pending
    mockReviewPromptStateItem.getValue.mockResolvedValue("dismissed");
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("returns false when state is 'rated'", async () => {
    // spec: review-prompt.spec.md#condition-1--state-is-pending
    mockReviewPromptStateItem.getValue.mockResolvedValue("rated");
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("does not read further storage items when state is non-pending", async () => {
    // spec: review-prompt.spec.md#condition-1--state-is-pending (early return)
    mockReviewPromptStateItem.getValue.mockResolvedValue("dismissed");
    await shouldShowReviewPrompt();
    expect(mockReviewPromptSnoozedUntilItem.getValue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — Condition 2: not snoozed
// spec: review-prompt.spec.md#condition-2--not-snoozed
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — Condition 2: snooze", () => {
  beforeEach(() => {
    mockReviewPromptStateItem.getValue.mockResolvedValue("pending");
  });

  it("returns false when snoozedUntil is in the future", async () => {
    // spec: review-prompt.spec.md#condition-2--not-snoozed
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(
      hoursFromNow(2)
    );
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("proceeds past condition 2 when snoozedUntil is in the past", async () => {
    // spec: review-prompt.spec.md#condition-2--not-snoozed
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(hoursAgo(1));
    // Condition 3 will fail (installedAt is null) — that's fine, we just verify
    // condition 2 did not short-circuit.
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(null);
    expect(await shouldShowReviewPrompt()).toBe(false);
    expect(mockExtensionInstalledAtItem.getValue).toHaveBeenCalled();
  });

  it("proceeds past condition 2 when snoozedUntil is null", async () => {
    // spec: review-prompt.spec.md#condition-2--not-snoozed
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(null);
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(null);
    await shouldShowReviewPrompt();
    expect(mockExtensionInstalledAtItem.getValue).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — Condition 3: minimum install age
// spec: review-prompt.spec.md#condition-3--minimum-install-age
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — Condition 3: install age", () => {
  beforeEach(() => {
    mockReviewPromptStateItem.getValue.mockResolvedValue("pending");
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(null);
  });

  it("returns false when extensionInstalledAt is null", async () => {
    // spec: review-prompt.spec.md#condition-3--minimum-install-age
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(null);
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("returns false when installed less than 7 days ago", async () => {
    // spec: review-prompt.spec.md#condition-3--minimum-install-age
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(daysAgo(3));
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("returns false when installed exactly 6 days ago", async () => {
    // spec: review-prompt.spec.md#condition-3--minimum-install-age
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(daysAgo(6));
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("proceeds past condition 3 when installed 8 days ago", async () => {
    // spec: review-prompt.spec.md#condition-3--minimum-install-age
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(daysAgo(8));
    // Condition 4 will fail (insertions = 0) — we just verify condition 3 passed
    mockTotalSnippetInsertionsItem.getValue.mockResolvedValue(0);
    await shouldShowReviewPrompt();
    expect(mockTotalSnippetInsertionsItem.getValue).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — Condition 4: minimum usage
// spec: review-prompt.spec.md#condition-4--minimum-usage
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — Condition 4: usage", () => {
  beforeEach(() => {
    mockReviewPromptStateItem.getValue.mockResolvedValue("pending");
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(null);
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(daysAgo(8));
  });

  it("returns false when totalSnippetInsertions is 0", async () => {
    // spec: review-prompt.spec.md#condition-4--minimum-usage
    mockTotalSnippetInsertionsItem.getValue.mockResolvedValue(0);
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("returns false when totalSnippetInsertions is 19", async () => {
    // spec: review-prompt.spec.md#condition-4--minimum-usage
    mockTotalSnippetInsertionsItem.getValue.mockResolvedValue(19);
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("proceeds past condition 4 when insertions is exactly 20", async () => {
    // spec: review-prompt.spec.md#condition-4--minimum-usage
    mockTotalSnippetInsertionsItem.getValue.mockResolvedValue(20);
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(null);
    const result = await shouldShowReviewPrompt();
    expect(result).toBe(true);
  });

  it("proceeds past condition 4 when insertions is greater than 20", async () => {
    // spec: review-prompt.spec.md#condition-4--minimum-usage
    mockTotalSnippetInsertionsItem.getValue.mockResolvedValue(100);
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(null);
    const result = await shouldShowReviewPrompt();
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — Condition 5: no recent errors
// spec: review-prompt.spec.md#condition-5--no-recent-errors
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — Condition 5: no recent errors", () => {
  beforeEach(() => {
    setupEligibleState();
  });

  it("returns false when lastSentryErrorAt is within 24 hours", async () => {
    // spec: review-prompt.spec.md#condition-5--no-recent-errors
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(hoursAgo(2));
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("returns false when lastSentryErrorAt is 1 hour ago", async () => {
    // spec: review-prompt.spec.md#condition-5--no-recent-errors
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(hoursAgo(1));
    expect(await shouldShowReviewPrompt()).toBe(false);
  });

  it("snoozes when condition 5 fails (fire-and-forget side-effect)", async () => {
    // spec: review-prompt.spec.md#condition-5--no-recent-errors
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(hoursAgo(2));
    await shouldShowReviewPrompt();
    // Allow microtask queue to flush the fire-and-forget snooze
    await Promise.resolve();
    expect(mockReviewPromptSnoozedUntilItem.setValue).toHaveBeenCalledOnce();
  });

  it("does not throw when snoozeReviewPrompt rejects during condition 5 failure", async () => {
    // spec: review-prompt.spec.md#condition-5--no-recent-errors
    // Exercises the fire-and-forget .catch(() => {}) callback on line 78
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(hoursAgo(2));
    mockReviewPromptSnoozedUntilItem.setValue.mockRejectedValue(
      new Error("storage write failed")
    );
    // shouldShowReviewPrompt must still return false without throwing
    await expect(shouldShowReviewPrompt()).resolves.toBe(false);
    // Flush microtask queue so the rejected promise is handled
    await Promise.resolve();
    // Restore so subsequent describe blocks get the default resolved mock
    mockReviewPromptSnoozedUntilItem.setValue.mockResolvedValue(undefined);
  });

  it("returns true when lastSentryErrorAt is null", async () => {
    // spec: review-prompt.spec.md#condition-5--no-recent-errors
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(null);
    expect(await shouldShowReviewPrompt()).toBe(true);
  });

  it("returns true when lastSentryErrorAt is older than 24 hours", async () => {
    // spec: review-prompt.spec.md#condition-5--no-recent-errors
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(hoursAgo(25));
    expect(await shouldShowReviewPrompt()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — full eligible case
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — all conditions pass", () => {
  it("returns true when all 5 conditions are met", async () => {
    // spec: review-prompt.spec.md#eligibility
    setupEligibleState();
    expect(await shouldShowReviewPrompt()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldShowReviewPrompt — resilience
// spec: review-prompt.spec.md#resilience
// ---------------------------------------------------------------------------

describe("shouldShowReviewPrompt — resilience", () => {
  it("returns false (never throws) when reviewPromptStateItem.getValue rejects", async () => {
    // spec: review-prompt.spec.md#resilience
    mockReviewPromptStateItem.getValue.mockRejectedValue(
      new Error("storage error")
    );
    await expect(shouldShowReviewPrompt()).resolves.toBe(false);
  });

  it("returns false (never throws) when extensionInstalledAtItem.getValue rejects", async () => {
    // spec: review-prompt.spec.md#resilience
    mockReviewPromptStateItem.getValue.mockResolvedValue("pending");
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(null);
    mockExtensionInstalledAtItem.getValue.mockRejectedValue(
      new Error("storage error")
    );
    await expect(shouldShowReviewPrompt()).resolves.toBe(false);
  });

  it("returns false (never throws) when totalSnippetInsertionsItem.getValue rejects", async () => {
    // spec: review-prompt.spec.md#resilience
    mockReviewPromptStateItem.getValue.mockResolvedValue("pending");
    mockReviewPromptSnoozedUntilItem.getValue.mockResolvedValue(null);
    mockExtensionInstalledAtItem.getValue.mockResolvedValue(daysAgo(8));
    mockTotalSnippetInsertionsItem.getValue.mockRejectedValue(
      new Error("storage error")
    );
    await expect(shouldShowReviewPrompt()).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setReviewPromptState
// spec: review-prompt.spec.md#state-helpers
// ---------------------------------------------------------------------------

describe("setReviewPromptState", () => {
  it("writes 'shown' to reviewPromptStateItem", async () => {
    // spec: review-prompt.spec.md#setreviewpromptstate
    await setReviewPromptState("shown");
    expect(mockReviewPromptStateItem.setValue).toHaveBeenCalledWith("shown");
  });

  it("writes 'dismissed' to reviewPromptStateItem", async () => {
    // spec: review-prompt.spec.md#setreviewpromptstate
    await setReviewPromptState("dismissed");
    expect(mockReviewPromptStateItem.setValue).toHaveBeenCalledWith(
      "dismissed"
    );
  });

  it("writes 'rated' to reviewPromptStateItem", async () => {
    // spec: review-prompt.spec.md#setreviewpromptstate
    await setReviewPromptState("rated");
    expect(mockReviewPromptStateItem.setValue).toHaveBeenCalledWith("rated");
  });
});

// ---------------------------------------------------------------------------
// snoozeReviewPrompt
// spec: review-prompt.spec.md#state-helpers
// ---------------------------------------------------------------------------

describe("snoozeReviewPrompt", () => {
  it("writes a future ISO timestamp to reviewPromptSnoozedUntilItem", async () => {
    // spec: review-prompt.spec.md#snoozereviewprompt
    const before = Date.now();
    await snoozeReviewPrompt(24);
    const after = Date.now();

    expect(mockReviewPromptSnoozedUntilItem.setValue).toHaveBeenCalledOnce();
    const writtenValue = (
      mockReviewPromptSnoozedUntilItem.setValue.mock.calls[0] as unknown[]
    )[0] as string;
    const writtenMs = new Date(writtenValue).getTime();

    const expectedMin = before + 24 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;
    expect(writtenMs).toBeGreaterThanOrEqual(expectedMin);
    expect(writtenMs).toBeLessThanOrEqual(expectedMax);
  });

  it("snooze duration scales with the hours parameter", async () => {
    // spec: review-prompt.spec.md#snoozereviewprompt
    const before = Date.now();
    await snoozeReviewPrompt(48);
    const writtenValue = (
      mockReviewPromptSnoozedUntilItem.setValue.mock.calls[0] as unknown[]
    )[0] as string;
    const writtenMs = new Date(writtenValue).getTime();
    expect(writtenMs).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// getStoreReviewUrl
// spec: review-prompt.spec.md#store-url-resolution
// ---------------------------------------------------------------------------

describe("getStoreReviewUrl", () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it("returns Firefox Add-ons URL when userAgent contains 'Firefox'", () => {
    // spec: review-prompt.spec.md#store-url-resolution
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0",
      configurable: true,
    });
    expect(getStoreReviewUrl()).toBe(
      "https://addons.mozilla.org/firefox/addon/clipio/"
    );
  });

  it("returns Chrome Web Store URL using browser.runtime.id for non-Firefox", () => {
    // spec: review-prompt.spec.md#store-url-resolution
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
      configurable: true,
    });
    // browser.runtime.id is "test-extension-id" from the mock
    expect(getStoreReviewUrl()).toBe(
      "https://chromewebstore.google.com/detail/test-extension-id/reviews"
    );
  });

  it("returns Chrome Web Store fallback URL when browser.runtime.id throws", () => {
    // spec: review-prompt.spec.md#store-url-resolution
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 Chrome/120.0.0.0",
      configurable: true,
    });
    const originalId = browser.runtime.id;
    Object.defineProperty(browser.runtime, "id", {
      get: () => {
        throw new Error("not available");
      },
      configurable: true,
    });
    try {
      expect(getStoreReviewUrl()).toBe("https://chromewebstore.google.com/");
    } finally {
      Object.defineProperty(browser.runtime, "id", {
        value: originalId,
        configurable: true,
      });
    }
  });
});
