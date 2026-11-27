import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatStoredDate,
  isValidStoredDateFormat,
  isValidStoredDate,
  toStoredDate,
  todayStoredDate,
} from "./editor-date";

afterEach(() => {
  vi.useRealTimers();
});

describe("isValidStoredDate", () => {
  it("accepts a real calendar date", () => {
    expect(isValidStoredDate("2025-06-15")).toBe(true);
    expect(isValidStoredDate("2024-02-29")).toBe(true);
  });

  it("rejects impossible dates and other token shapes", () => {
    // Negative cases: a regex-only check lets the replacement write an invalid
    // token that the content helper later turns into "Invalid Date".
    expect(isValidStoredDate("2025-02-30")).toBe(false);
    expect(isValidStoredDate("2025-13-01")).toBe(false);
    expect(isValidStoredDate("15/06/2025")).toBe(false);
    expect(isValidStoredDate("2025-6-15")).toBe(false);
    expect(isValidStoredDate("")).toBe(false);
  });
});

describe("toStoredDate", () => {
  it("uses the local calendar date, not the UTC one", () => {
    expect(toStoredDate(new Date(2025, 5, 15, 23, 30))).toBe("2025-06-15");
  });

  it("returns null for an invalid date", () => {
    expect(toStoredDate(new Date("not a date"))).toBeNull();
  });
});

describe("todayStoredDate", () => {
  it("uses the local calendar day, not the UTC one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15, 23, 30));
    expect(todayStoredDate()).toBe("2025-06-15");
  });
});

describe("isValidStoredDateFormat", () => {
  it("accepts only the formats the picker can write", () => {
    expect(isValidStoredDateFormat("short")).toBe(true);
    expect(isValidStoredDateFormat(" tomato ")).toBe(false);
    expect(isValidStoredDateFormat("")).toBe(false);
  });
});

describe("formatStoredDate", () => {
  it("formats a valid stored date in every supported format", () => {
    expect(formatStoredDate("2025-06-15")).toBe("Jun 15, 2025");
    expect(formatStoredDate("2025-06-15", "iso")).toBe("2025-06-15");
    expect(formatStoredDate("2025-06-15", "us")).toBe("6/15/2025");
    expect(formatStoredDate("2025-06-15", "eu")).toBe("15/06/2025");
    expect(formatStoredDate("2025-06-15", "long")).toBe("Jun 15, 2025");
    expect(formatStoredDate("2025-06-15", "short")).toBe("Jun 15");
  });

  it("falls back to the long format for an unknown format", () => {
    expect(formatStoredDate("2025-06-15", "tomato")).toBe("Jun 15, 2025");
  });

  it("leaves an invalid value visible instead of throwing", () => {
    expect(formatStoredDate("2025-06-31")).toBe("2025-06-31");
  });
});
