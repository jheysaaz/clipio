import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatStoredDate,
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

describe("formatStoredDate", () => {
  it("formats a valid stored date", () => {
    expect(formatStoredDate("2025-06-15")).toBe("Jun 15, 2025");
  });

  it("leaves an invalid value visible instead of throwing", () => {
    expect(formatStoredDate("2025-06-31")).toBe("2025-06-31");
  });
});
