/**
 * Tests for src/lib/snippet-schema.ts
 * spec: specs/import-validation.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  IMPORT_LIMITS,
  validateImportedSnippet,
  validateImportPayload,
  isValidImportedSnippet,
} from "./snippet-schema";

const valid = (overrides: Record<string, unknown> = {}) => ({
  id: "abc-123",
  label: "My snippet",
  shortcut: "/mine",
  content: "Hello",
  ...overrides,
});

function accept(raw: unknown) {
  const r = validateImportedSnippet(raw);
  if (!r.ok) throw new Error(`expected accept, got ${r.reason}`);
  return r.snippet;
}

function reject(raw: unknown) {
  const r = validateImportedSnippet(raw);
  if (r.ok) throw new Error("expected reject, got accept");
  return r.reason;
}

describe("IMPORT_LIMITS", () => {
  it("bounds content below what could exhaust the sync quota on its own", () => {
    // storage.sync allows 102,400 bytes total. 32,000 chars of content is
    // comfortably under that even after JSON encoding.
    expect(IMPORT_LIMITS.maxContentLength).toBeLessThan(102_400);
  });

  it("allows more snippets than the 512 sync cap, so local mode is not regressed", () => {
    expect(IMPORT_LIMITS.maxSnippets).toBeGreaterThan(512);
  });
});

describe("validateImportedSnippet — accepted", () => {
  it("accepts and normalises a well-formed record", () => {
    const s = accept(valid());
    expect(s.id).toBe("abc-123");
    expect(s.tags).toEqual([]);
    expect(s.usageCount).toBe(0);
  });

  it("does not carry a contentFormat key into storage", () => {
    // The field was retired. A 1.x export still carries it, so it is accepted
    // on the wire, but it must not survive into a stored snippet.
    // spec: specs/content-format-migration.spec.md
    expect(Object.keys(accept(valid()))).not.toContain("contentFormat");
    expect(Object.keys(accept(valid({ contentFormat: "html" })))).not.toContain(
      "contentFormat"
    );
    expect(
      Object.keys(accept(valid({ contentFormat: "markdown" })))
    ).not.toContain("contentFormat");
  });

  it("still accepts a legacy contentFormat on the wire", () => {
    // Rejection would lock a user out of their own 1.x export.
    expect(accept(valid({ contentFormat: "html" })).id).toBe("abc-123");
  });

  /**
   * The body must be CONVERTED, not merely stripped of its flag.
   *
   * These two are easy to confuse and only one of them is correct. Stripping
   * the flag while leaving an HTML body stores HTML that is thereafter treated
   * as markdown — it inserts as visible escaped text, and because the flag that
   * recorded the true format is now gone, there is no way back. This validator
   * is also the storage-level import path, so it is the last point at which the
   * body can be fixed.
   * spec: specs/content-format-migration.spec.md
   */
  it("converts a legacy html body to markdown", () => {
    const out = accept(
      valid({ contentFormat: "html", content: "<p>Hi</p><p>There</p>" })
    );
    expect(out.content).toBe("Hi\n\nThere");
  });

  it("leaves no markup in a converted body", () => {
    const out = accept(
      valid({ contentFormat: "html", content: "<p><strong>Bold</strong></p>" })
    );
    expect(out.content).not.toContain("<p>");
    expect(out.content).toBe("**Bold**");
  });

  it("does not convert a body already marked markdown", () => {
    expect(
      accept(valid({ contentFormat: "markdown", content: "**bold** body" }))
        .content
    ).toBe("**bold** body");
  });

  it("converts a legacy html body with no flag change to its id", () => {
    // The conversion must not disturb the rest of the record.
    const out = accept(
      valid({ id: "keep-id", contentFormat: "html", content: "<p>x</p>" })
    );
    expect(out.id).toBe("keep-id");
    expect(out.content).toBe("x");
  });

  it("keeps valid timestamps", () => {
    const s = accept(valid({ createdAt: "2024-01-01T00:00:00.000Z" }));
    expect(s.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("preserves a usageCount of zero", () => {
    expect(accept(valid({ usageCount: 0 })).usageCount).toBe(0);
  });

  it("preserves a positive usageCount", () => {
    expect(accept(valid({ usageCount: 42 })).usageCount).toBe(42);
  });

  it("accepts a tags array", () => {
    expect(accept(valid({ tags: ["a", "b"] })).tags).toEqual(["a", "b"]);
  });

  it("accepts an empty tags array", () => {
    expect(accept(valid({ tags: [] })).tags).toEqual([]);
  });

  it("accepts a record with no optional fields at all", () => {
    const s = accept({ id: "x", label: "L", shortcut: "/s", content: "c" });
    expect(s.usageCount).toBe(0);
    expect(s.tags).toEqual([]);
  });

  it("generates a valid ISO timestamp when createdAt is missing", () => {
    const s = accept(valid());
    expect(Number.isNaN(Date.parse(s.createdAt))).toBe(false);
  });

  it("defaults a missing usageCount to zero", () => {
    expect(accept(valid({ usageCount: undefined })).usageCount).toBe(0);
  });
});

describe("validateImportedSnippet — rejected", () => {
  it("rejects null", () => {
    expect(reject(null)).toBe("not-an-object");
  });

  it("rejects undefined", () => {
    expect(reject(undefined)).toBe("not-an-object");
  });

  it("rejects a string", () => {
    expect(reject("nope")).toBe("not-an-object");
  });

  it("rejects a number", () => {
    expect(reject(7)).toBe("not-an-object");
  });

  it("rejects an array", () => {
    expect(reject([])).toBe("not-an-object");
  });

  it("rejects a missing id", () => {
    expect(reject(valid({ id: undefined }))).toBe("missing-id");
  });

  it("rejects an empty id", () => {
    expect(reject(valid({ id: "" }))).toBe("missing-id");
  });

  it("rejects a numeric id", () => {
    expect(reject(valid({ id: 1 }))).toBe("missing-id");
  });

  it("rejects an over-long id", () => {
    expect(reject(valid({ id: "a".repeat(500) }))).toBe("id-too-long");
  });

  // Prototype pollution: the id becomes a storage key and an object-store keyPath.
  it("rejects an id containing __proto__", () => {
    expect(reject(valid({ id: "__proto__" }))).toBe("id-unsafe");
  });

  it("rejects an id containing constructor", () => {
    expect(reject(valid({ id: "xconstructorx" }))).toBe("id-unsafe");
  });

  it("rejects an id containing prototype", () => {
    expect(reject(valid({ id: "myprototypeid" }))).toBe("id-unsafe");
  });

  it("rejects a missing label", () => {
    expect(reject(valid({ label: undefined }))).toBe("missing-label");
  });

  it("rejects an over-long label", () => {
    expect(reject(valid({ label: "x".repeat(500) }))).toBe("label-too-long");
  });

  it("rejects a missing shortcut", () => {
    expect(reject(valid({ shortcut: undefined }))).toBe("missing-shortcut");
  });

  it("rejects an over-long shortcut", () => {
    expect(reject(valid({ shortcut: "x".repeat(500) }))).toBe(
      "shortcut-too-long"
    );
  });

  it("rejects a missing content", () => {
    expect(reject(valid({ content: undefined }))).toBe("missing-content");
  });

  it("rejects non-string content", () => {
    expect(reject(valid({ content: 42 }))).toBe("missing-content");
  });

  it("rejects an over-long content string", () => {
    // The specific quota-bricking case: 10 KB in one record is enough to
    // exhaust storage.sync on its own.
    expect(reject(valid({ content: "x".repeat(40_000) }))).toBe(
      "content-too-long"
    );
  });

  it("accepts content exactly at the limit", () => {
    const s = accept(
      valid({ content: "x".repeat(IMPORT_LIMITS.maxContentLength) })
    );
    expect(s.content).toHaveLength(IMPORT_LIMITS.maxContentLength);
  });

  it("rejects an unknown contentFormat", () => {
    expect(reject(valid({ contentFormat: "rtf" }))).toBe("bad-content-format");
  });

  it("rejects a numeric contentFormat", () => {
    expect(reject(valid({ contentFormat: 2 }))).toBe("bad-content-format");
  });

  it("rejects a non-array tags value", () => {
    expect(reject(valid({ tags: "a,b" }))).toBe("bad-tags");
  });

  it("rejects a tags array containing a non-string", () => {
    expect(reject(valid({ tags: ["ok", 5] }))).toBe("bad-tags");
  });

  it("rejects too many tags", () => {
    const many = Array.from(
      { length: IMPORT_LIMITS.maxTags + 1 },
      (_, i) => `t${i}`
    );
    expect(reject(valid({ tags: many }))).toBe("bad-tags");
  });

  it("rejects an over-long tag", () => {
    expect(reject(valid({ tags: ["x".repeat(200)] }))).toBe("bad-tags");
  });

  it("rejects an unparseable createdAt", () => {
    expect(reject(valid({ createdAt: "not-a-date" }))).toBe("bad-timestamp");
  });

  it("rejects an unparseable updatedAt", () => {
    expect(reject(valid({ updatedAt: "" }))).toBe("bad-timestamp");
  });

  it("rejects a negative usageCount", () => {
    expect(reject(valid({ usageCount: -1 }))).toBe("bad-usage-count");
  });

  it("rejects a fractional usageCount", () => {
    expect(reject(valid({ usageCount: 1.5 }))).toBe("bad-usage-count");
  });

  it("rejects a usageCount beyond MAX_SAFE_INTEGER", () => {
    // The smallest integer that is not safely representable, so the value is
    // exact rather than a literal that has already lost precision.
    expect(reject(valid({ usageCount: Number.MAX_SAFE_INTEGER + 2 }))).toBe(
      "bad-usage-count"
    );
  });

  it("rejects a NaN usageCount", () => {
    expect(reject(valid({ usageCount: Number.NaN }))).toBe("bad-usage-count");
  });

  it("rejects an Infinity usageCount", () => {
    expect(reject(valid({ usageCount: Number.POSITIVE_INFINITY }))).toBe(
      "bad-usage-count"
    );
  });

  it("rejects a string usageCount", () => {
    expect(reject(valid({ usageCount: "5" }))).toBe("bad-usage-count");
  });
});

describe("validateImportPayload", () => {
  it("accepts a well-formed payload", () => {
    const r = validateImportPayload([valid({ id: "a" }), valid({ id: "b" })]);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toHaveLength(0);
    expect(r.tooManySnippets).toBe(false);
  });

  it("returns nothing for a non-array payload", () => {
    const r = validateImportPayload({ nope: true });
    expect(r.accepted).toEqual([]);
    expect(r.tooManySnippets).toBe(false);
  });

  it("returns nothing for null", () => {
    expect(validateImportPayload(null).accepted).toEqual([]);
  });

  // One malformed entry must not cost the user their other snippets.
  it("keeps the good records when one record is malformed", () => {
    const r = validateImportPayload([
      valid({ id: "good1" }),
      null,
      valid({ id: "good2" }),
    ]);
    expect(r.accepted.map((s) => s.id)).toEqual(["good1", "good2"]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]).toEqual({ index: 1, reason: "not-an-object" });
  });

  it("reports the index of each rejected record", () => {
    const r = validateImportPayload([
      valid({ id: "a" }),
      valid({ id: "" }),
      valid({ id: "c" }),
      valid({ content: "x".repeat(99_999) }),
    ]);
    expect(r.rejected).toEqual([
      { index: 1, reason: "missing-id" },
      { index: 3, reason: "content-too-long" },
    ]);
  });

  it("keeps the first of two records with the same id and rejects the second", () => {
    const r = validateImportPayload([
      valid({ id: "dup", label: "first" }),
      valid({ id: "dup", label: "second" }),
    ]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].label).toBe("first");
    expect(r.rejected).toHaveLength(1);
  });

  it("truncates at maxSnippets and flags it", () => {
    const many = Array.from(
      { length: IMPORT_LIMITS.maxSnippets + 50 },
      (_, i) => valid({ id: `i${i}` })
    );
    const r = validateImportPayload(many);
    expect(r.accepted).toHaveLength(IMPORT_LIMITS.maxSnippets);
    expect(r.tooManySnippets).toBe(true);
  });

  it("does not flag truncation at exactly maxSnippets", () => {
    const exact = Array.from({ length: IMPORT_LIMITS.maxSnippets }, (_, i) =>
      valid({ id: `i${i}` })
    );
    const r = validateImportPayload(exact);
    expect(r.accepted).toHaveLength(IMPORT_LIMITS.maxSnippets);
    expect(r.tooManySnippets).toBe(false);
  });

  it("returns an empty accepted list for an all-malformed payload", () => {
    const r = validateImportPayload([null, 1, "x"]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toHaveLength(3);
  });

  it("returns an empty accepted list for an empty payload", () => {
    expect(validateImportPayload([]).accepted).toEqual([]);
  });
});

describe("isValidImportedSnippet", () => {
  it("agrees with validateImportedSnippet for a valid record", () => {
    expect(isValidImportedSnippet(valid())).toBe(true);
  });

  it("agrees for an invalid record", () => {
    expect(isValidImportedSnippet(null)).toBe(false);
  });

  it("agrees for every malformed shape tried", () => {
    for (const bad of [undefined, 1, "s", [], valid({ id: "" })]) {
      expect(isValidImportedSnippet(bad)).toBe(validateImportedSnippet(bad).ok);
    }
  });
});
