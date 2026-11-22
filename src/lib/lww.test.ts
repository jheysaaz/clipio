import { describe, it, expect } from "vitest";
import type { Snippet } from "@/types";
import {
  LEGACY_WRITER_ID,
  compareLww,
  isNewer,
  snippetRev,
  snippetWriter,
} from "./lww";

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "S",
    content: "body",
    shortcut: "/s",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("snippetRev", () => {
  it("returns the stored revision", () => {
    expect(snippetRev(snippet({ rev: 7 }))).toBe(7);
  });

  it("treats missing and invalid revisions as zero", () => {
    expect(snippetRev(snippet())).toBe(0);
    expect(snippetRev(snippet({ rev: Number.NaN }))).toBe(0);
    expect(snippetRev(snippet({ rev: -3 }))).toBe(0);
  });
});

describe("snippetWriter", () => {
  it("uses the stored writer", () => {
    expect(snippetWriter(snippet({ updatedBy: "device-a" }))).toBe("device-a");
  });

  it("uses the legacy writer when absent or empty", () => {
    expect(snippetWriter(snippet())).toBe(LEGACY_WRITER_ID);
    expect(snippetWriter(snippet({ updatedBy: "" }))).toBe(LEGACY_WRITER_ID);
  });
});

describe("compareLww", () => {
  it("prefers the newer timestamp even when its revision is lower", () => {
    const a = snippet({
      updatedAt: "2026-02-02T00:00:00.000Z",
      rev: 1,
      updatedBy: "a",
    });
    const b = snippet({
      updatedAt: "2026-01-01T00:00:00.000Z",
      rev: 99,
      updatedBy: "z",
    });
    expect(compareLww(a, b)).toBeGreaterThan(0);
    expect(isNewer(a, b)).toBe(true);
    expect(isNewer(b, a)).toBe(false);
  });

  it("breaks an equal timestamp by revision", () => {
    const lower = snippet({ rev: 1, updatedBy: "z" });
    const higher = snippet({ rev: 2, updatedBy: "a" });
    expect(compareLww(higher, lower)).toBeGreaterThan(0);
  });

  it("breaks an equal timestamp and revision by writer id", () => {
    const a = snippet({ rev: 3, updatedBy: "a" });
    const z = snippet({ rev: 3, updatedBy: "z" });
    expect(compareLww(z, a)).toBeGreaterThan(0);
    expect(compareLww(a, z)).toBeLessThan(0);
  });

  it("returns zero for records with the same ordering keys", () => {
    const a = snippet();
    const b = snippet({ id: "different" });
    expect(compareLww(a, b)).toBe(0);
    expect(isNewer(a, b)).toBe(false);
  });

  it("does not mutate either record", () => {
    const a = snippet({ rev: 1 });
    const b = snippet({ rev: 2 });
    const before = JSON.stringify([a, b]);
    compareLww(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
