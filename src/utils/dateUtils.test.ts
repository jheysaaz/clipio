/**
 * Tests for src/utils/dateUtils.ts
 * spec: specs/date-utils.spec.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRelativeTime, formatShortDate, formatFullDate } from "./dateUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2025-06-15T12:00:00.000Z");

/** Returns a Date that is `seconds` seconds before NOW. */
function secsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

// ---------------------------------------------------------------------------
// getRelativeTime
// ---------------------------------------------------------------------------

describe("getRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // spec: getRelativeTime — MUST return "just now" when < 60 seconds
  it('returns "just now" for 0 seconds ago', () => {
    expect(getRelativeTime(secsAgo(0))).toBe("just now");
  });

  it('returns "just now" for 30 seconds ago', () => {
    expect(getRelativeTime(secsAgo(30))).toBe("just now");
  });

  it('returns "just now" for 59 seconds ago', () => {
    expect(getRelativeTime(secsAgo(59))).toBe("just now");
  });

  // spec: MUST return "1 minute ago" at exactly 60 seconds
  it('returns "1 minute ago" for exactly 60 seconds', () => {
    expect(getRelativeTime(secsAgo(60))).toBe("1 minute ago");
  });

  it('returns "1 minute ago" for 89 seconds', () => {
    expect(getRelativeTime(secsAgo(89))).toBe("1 minute ago");
  });

  // spec: MUST return "N minutes ago" for 2–59 minutes
  it('returns "2 minutes ago" for 120 seconds', () => {
    expect(getRelativeTime(secsAgo(120))).toBe("2 minutes ago");
  });

  it('returns "59 minutes ago" for 59 minutes', () => {
    expect(getRelativeTime(secsAgo(59 * 60))).toBe("59 minutes ago");
  });

  // spec: MUST return "1 hour ago" at exactly 60 minutes
  it('returns "1 hour ago" for exactly 60 minutes', () => {
    expect(getRelativeTime(secsAgo(60 * 60))).toBe("1 hour ago");
  });

  // spec: MUST return "N hours ago" for 2–23 hours
  it('returns "2 hours ago" for 2 hours', () => {
    expect(getRelativeTime(secsAgo(2 * 3600))).toBe("2 hours ago");
  });

  it('returns "23 hours ago" for 23 hours', () => {
    expect(getRelativeTime(secsAgo(23 * 3600))).toBe("23 hours ago");
  });

  // spec: MUST return "1 day ago" at exactly 24 hours
  it('returns "1 day ago" for exactly 24 hours', () => {
    expect(getRelativeTime(secsAgo(24 * 3600))).toBe("1 day ago");
  });

  // spec: MUST return "N days ago" for 2–6 days
  it('returns "2 days ago" for 2 days', () => {
    expect(getRelativeTime(secsAgo(2 * 86400))).toBe("2 days ago");
  });

  it('returns "6 days ago" for 6 days', () => {
    expect(getRelativeTime(secsAgo(6 * 86400))).toBe("6 days ago");
  });

  // spec: MUST return "1 week ago" at exactly 7 days
  it('returns "1 week ago" for exactly 7 days', () => {
    expect(getRelativeTime(secsAgo(7 * 86400))).toBe("1 week ago");
  });

  // spec: MUST return "N weeks ago" for 2–3 weeks
  it('returns "2 weeks ago" for 14 days', () => {
    expect(getRelativeTime(secsAgo(14 * 86400))).toBe("2 weeks ago");
  });

  it('returns "3 weeks ago" for 21 days', () => {
    expect(getRelativeTime(secsAgo(21 * 86400))).toBe("3 weeks ago");
  });

  // spec: MUST return "1 month ago" around 28-30 days
  it('returns "1 month ago" for 30 days', () => {
    expect(getRelativeTime(secsAgo(30 * 86400))).toBe("1 month ago");
  });

  // spec: MUST return "N months ago" for 2–11 months
  it('returns "2 months ago" for 60 days', () => {
    expect(getRelativeTime(secsAgo(60 * 86400))).toBe("2 months ago");
  });

  it('returns "11 months ago" for 330 days', () => {
    expect(getRelativeTime(secsAgo(330 * 86400))).toBe("11 months ago");
  });

  // spec: MUST return "1 year ago" at exactly 365 days
  it('returns "1 year ago" for 365 days', () => {
    expect(getRelativeTime(secsAgo(365 * 86400))).toBe("1 year ago");
  });

  // spec: MUST return "N years ago" for 2+ years
  it('returns "2 years ago" for 730 days', () => {
    expect(getRelativeTime(secsAgo(730 * 86400))).toBe("2 years ago");
  });

  it('returns "5 years ago" for 5 * 365 days', () => {
    expect(getRelativeTime(secsAgo(5 * 365 * 86400))).toBe("5 years ago");
  });

  // spec: MUST accept ISO string input
  it("accepts an ISO date string", () => {
    const isoString = new Date(NOW.getTime() - 90 * 1000).toISOString();
    expect(getRelativeTime(isoString)).toBe("1 minute ago");
  });

  // spec: future dates treated as 0 seconds → "just now"
  it('returns "just now" for a future date', () => {
    const futureDate = new Date(NOW.getTime() + 10_000);
    expect(getRelativeTime(futureDate)).toBe("just now");
  });
});

// ---------------------------------------------------------------------------
// formatShortDate
// ---------------------------------------------------------------------------

describe("formatShortDate", () => {
  // spec: MUST return "Mon DD" format with en-US locale, no year
  // Note: Use UTC noon to avoid timezone shifts when passing ISO strings
  it("formats a known date as short date string", () => {
    expect(formatShortDate(new Date(2025, 10, 11))).toBe("Nov 11"); // months 0-indexed
  });

  it("formats January 1st correctly", () => {
    expect(formatShortDate(new Date(2025, 0, 1))).toBe("Jan 1");
  });

  it("formats June 15th correctly", () => {
    expect(formatShortDate(new Date(2025, 5, 15))).toBe("Jun 15");
  });

  // spec: MUST accept Date objects
  it("accepts a Date object", () => {
    expect(formatShortDate(new Date(2025, 11, 25))).toBe("Dec 25");
  });

  // spec: output MUST NOT include the year
  it("does not include the year in output", () => {
    const result = formatShortDate(new Date(2025, 5, 15));
    expect(result).not.toMatch(/2025/);
  });
});

// ---------------------------------------------------------------------------
// formatFullDate
// ---------------------------------------------------------------------------

describe("formatFullDate", () => {
  // spec: MUST return "Month DD, YYYY" format with en-US locale
  it("formats a known date as full date string", () => {
    expect(formatFullDate(new Date(2025, 10, 11))).toBe("November 11, 2025");
  });

  it("formats January 1st correctly", () => {
    expect(formatFullDate(new Date(2025, 0, 1))).toBe("January 1, 2025");
  });

  it("formats June 15th correctly", () => {
    expect(formatFullDate(new Date(2025, 5, 15))).toBe("June 15, 2025");
  });

  // spec: MUST accept Date objects
  it("accepts a Date object", () => {
    expect(formatFullDate(new Date(2025, 11, 25))).toBe("December 25, 2025");
  });

  // spec: output MUST include the year
  it("includes the year in output", () => {
    const result = formatFullDate(new Date(2025, 5, 15));
    expect(result).toMatch(/2025/);
  });

  // spec: output MUST include the full month name
  it("uses the full month name", () => {
    const result = formatFullDate(new Date(2025, 5, 15));
    expect(result).toBe("June 15, 2025");
  });
});
