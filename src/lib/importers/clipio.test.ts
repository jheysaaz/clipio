/**
 * Tests for src/lib/importers/clipio.ts
 * spec: specs/importers.spec.md#ClipioParser
 */

import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { ClipioParser, importClipioZip } from "./clipio";
import type { MediaMetadata } from "~/storage/backends/media";

const makeSnippet = (overrides = {}) => ({
  id: "test-id",
  label: "Test Snippet",
  shortcut: "ts",
  content: "Test content",
  tags: ["tag1"],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("ClipioParser.canParse", () => {
  // spec: MUST return true for versioned envelope
  it("returns true for versioned envelope", () => {
    expect(
      ClipioParser.canParse({ format: "clipio", version: 1, snippets: [] })
    ).toBe(true);
  });

  // spec: MUST return true for empty array
  it("returns true for empty array", () => {
    expect(ClipioParser.canParse([])).toBe(true);
  });

  // spec: MUST return true for array with valid snippet shape
  it("returns true for array with valid first element", () => {
    expect(ClipioParser.canParse([makeSnippet()])).toBe(true);
  });

  // spec: MUST return false for null
  it("returns false for null", () => {
    expect(ClipioParser.canParse(null)).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(ClipioParser.canParse("string")).toBe(false);
    expect(ClipioParser.canParse(42)).toBe(false);
  });

  // spec: MUST return false for array whose first element is missing required fields
  it("returns false when first element is missing id", () => {
    expect(ClipioParser.canParse([{ shortcut: "hi", content: "c" }])).toBe(
      false
    );
  });

  it("returns false when first element is missing shortcut", () => {
    expect(ClipioParser.canParse([{ id: "x", content: "c" }])).toBe(false);
  });

  it("returns false when first element is missing content", () => {
    expect(ClipioParser.canParse([{ id: "x", shortcut: "hi" }])).toBe(false);
  });
});

describe("ClipioParser.parse", () => {
  // spec: MUST return [] for empty array
  it("returns empty array for empty array input", () => {
    expect(ClipioParser.parse([])).toEqual([]);
  });

  // spec: MUST return [] for envelope with empty snippets
  it("returns empty array for envelope with empty snippets", () => {
    expect(
      ClipioParser.parse({ format: "clipio", version: 1, snippets: [] })
    ).toEqual([]);
  });

  // spec: MUST parse versioned envelope by reading envelope.snippets
  it("parses snippets from versioned envelope", () => {
    const snippet = makeSnippet();
    const result = ClipioParser.parse({
      format: "clipio",
      version: 1,
      snippets: [snippet],
    });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Test Snippet");
    expect(result[0].shortcut).toBe("ts");
    expect(result[0].content).toBe("Test content");
  });

  // spec: MUST parse legacy bare array
  it("parses snippets from legacy bare array", () => {
    const snippet = makeSnippet({
      label: "Hello",
      shortcut: "h",
      content: "Hi there",
    });
    const result = ClipioParser.parse([snippet]);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Hello");
  });

  // spec: MUST set suggestedId === snippet.id
  it("maps suggestedId to the snippet id", () => {
    const snippet = makeSnippet({ id: "my-unique-id" });
    const result = ClipioParser.parse([snippet]);
    expect(result[0].suggestedId).toBe("my-unique-id");
  });

  // spec: MUST preserve tags from the source
  it("preserves tags", () => {
    const snippet = makeSnippet({ tags: ["work", "email"] });
    const result = ClipioParser.parse([snippet]);
    expect(result[0].tags).toEqual(["work", "email"]);
  });

  // spec: MUST default tags to [] when missing
  it("defaults tags to [] when not present", () => {
    const { tags: _omit, ...snippetWithoutTags } = makeSnippet();
    const result = ClipioParser.parse([snippetWithoutTags]);
    expect(result[0].tags).toEqual([]);
  });

  // spec: MUST always set unsupportedPlaceholders to []
  it("sets unsupportedPlaceholders to empty array", () => {
    const result = ClipioParser.parse([makeSnippet()]);
    expect(result[0].unsupportedPlaceholders).toEqual([]);
  });

  // spec: MUST skip items that fail validation (missing required fields)
  it("skips invalid items in the array", () => {
    const valid = makeSnippet({ id: "good" });
    const invalid = { noId: true, content: "c" };
    const result = ClipioParser.parse([invalid, valid]);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedId).toBe("good");
  });

  // spec: MUST handle envelope with mixed valid/invalid snippets
  it("filters out invalid snippets from envelope", () => {
    const valid = makeSnippet({ id: "valid-id" });
    const invalid = { id: 123, shortcut: "x", content: "c" }; // id is not a string
    const result = ClipioParser.parse({
      format: "clipio",
      version: 1,
      snippets: [valid, invalid],
    });
    expect(result).toHaveLength(1);
  });

  // Multiple snippets
  it("parses multiple snippets", () => {
    const snippets = [
      makeSnippet({ id: "1", label: "One", shortcut: "one" }),
      makeSnippet({ id: "2", label: "Two", shortcut: "two" }),
    ];
    const result = ClipioParser.parse(snippets);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("One");
    expect(result[1].label).toBe("Two");
  });
});

// ---------------------------------------------------------------------------
// Helpers for importClipioZip tests
// ---------------------------------------------------------------------------

function makeMediaMeta(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: "media-id-001",
    mimeType: "image/png",
    width: 1,
    height: 1,
    size: 4,
    originalSize: 4,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildZipFile(entries: Record<string, Uint8Array>): File {
  const zipped = zipSync(entries);
  return new File([zipped.buffer as ArrayBuffer], "test.clipio.zip", {
    type: "application/zip",
  });
}

function makeExportJson(overrides: Record<string, unknown> = {}): Uint8Array {
  const envelope = {
    version: 2,
    format: "clipio",
    exportedAt: "2025-01-01T00:00:00.000Z",
    snippets: [makeSnippet()],
    media: [],
    ...overrides,
  };
  return strToU8(JSON.stringify(envelope));
}

// ---------------------------------------------------------------------------
// importClipioZip
// ---------------------------------------------------------------------------

describe("importClipioZip", () => {
  it("parses a valid ZIP with snippets and no media", async () => {
    const file = buildZipFile({ "export.json": makeExportJson() });
    const result = await importClipioZip(file);

    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].label).toBe("Test Snippet");
    expect(result.mediaBlobs.size).toBe(0);
    expect(result.missingMediaIds).toHaveLength(0);
  });

  it("throws when export.json is missing from ZIP", async () => {
    const file = buildZipFile({
      "other-file.txt": strToU8("hello"),
    });
    await expect(importClipioZip(file)).rejects.toThrow(
      "Invalid Clipio ZIP: missing export.json"
    );
  });

  it("throws when export.json contains invalid JSON", async () => {
    const file = buildZipFile({ "export.json": strToU8("not json {{") });
    await expect(importClipioZip(file)).rejects.toThrow(
      "Invalid Clipio ZIP: export.json is not valid JSON"
    );
  });

  it("throws when export.json is not a Clipio export (wrong format)", async () => {
    const file = buildZipFile({
      "export.json": strToU8(JSON.stringify({ format: "other", version: 2 })),
    });
    await expect(importClipioZip(file)).rejects.toThrow(
      "Invalid Clipio ZIP: export.json is not a Clipio export"
    );
  });

  it("extracts media blobs from the media/ directory", async () => {
    const meta = makeMediaMeta({ id: "img-001", mimeType: "image/png" });
    const fakeImg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta] }),
      "media/img-001.png": fakeImg,
    });

    const result = await importClipioZip(file);

    expect(result.mediaBlobs.size).toBe(1);
    expect(result.mediaBlobs.has("img-001")).toBe(true);
    const entry = result.mediaBlobs.get("img-001")!;
    expect(entry.meta.mimeType).toBe("image/png");
    expect(entry.blob.type).toBe("image/png");
  });

  it("records missing media IDs when blob is absent from ZIP", async () => {
    const meta = makeMediaMeta({ id: "missing-img" });

    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta] }),
      // no media/missing-img.* file
    });

    const result = await importClipioZip(file);

    expect(result.missingMediaIds).toContain("missing-img");
    expect(result.mediaBlobs.size).toBe(0);
  });

  it("handles multiple media entries — some present, some missing", async () => {
    const meta1 = makeMediaMeta({ id: "present-img" });
    const meta2 = makeMediaMeta({ id: "absent-img" });
    const fakeImg = new Uint8Array([1, 2, 3, 4]);

    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta1, meta2] }),
      "media/present-img.png": fakeImg,
    });

    const result = await importClipioZip(file);

    expect(result.mediaBlobs.size).toBe(1);
    expect(result.mediaBlobs.has("present-img")).toBe(true);
    expect(result.missingMediaIds).toContain("absent-img");
  });

  it("uses MIME type from meta when present (image/webp)", async () => {
    const meta = makeMediaMeta({ id: "webp-img", mimeType: "image/webp" });
    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta] }),
      "media/webp-img.webp": new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    });

    const result = await importClipioZip(file);
    expect(result.mediaBlobs.get("webp-img")!.blob.type).toBe("image/webp");
  });

  it("guesses MIME type as image/jpeg for .jpg files when meta has no mimeType", async () => {
    const meta = makeMediaMeta({ id: "jpg-img", mimeType: "" });
    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta] }),
      "media/jpg-img.jpg": new Uint8Array([0xff, 0xd8]),
    });

    const result = await importClipioZip(file);
    const entry = result.mediaBlobs.get("jpg-img")!;
    // guessMimeFromPath returns "image/jpeg" for .jpg
    expect(entry.blob.type).toBe("image/jpeg");
  });

  it("guesses MIME type as image/gif for .gif files", async () => {
    const meta = makeMediaMeta({ id: "gif-img", mimeType: "" });
    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta] }),
      "media/gif-img.gif": new Uint8Array([0x47, 0x49, 0x46]),
    });

    const result = await importClipioZip(file);
    expect(result.mediaBlobs.get("gif-img")!.blob.type).toBe("image/gif");
  });

  it("defaults to image/png for unknown extensions", async () => {
    const meta = makeMediaMeta({ id: "unknown-img", mimeType: "" });
    const file = buildZipFile({
      "export.json": makeExportJson({ media: [meta] }),
      "media/unknown-img.bmp": new Uint8Array([0x42, 0x4d]),
    });

    const result = await importClipioZip(file);
    expect(result.mediaBlobs.get("unknown-img")!.blob.type).toBe("image/png");
  });

  it("handles envelope with no snippets key (returns empty)", async () => {
    const file = buildZipFile({
      "export.json": strToU8(
        JSON.stringify({ version: 2, format: "clipio", exportedAt: "" })
      ),
    });
    const result = await importClipioZip(file);
    expect(result.snippets).toHaveLength(0);
  });

  it("filters invalid snippets in the ZIP envelope", async () => {
    const valid = makeSnippet({ id: "valid-zip-id" });
    const invalid = { noId: true };
    const file = buildZipFile({
      "export.json": makeExportJson({ snippets: [valid, invalid] }),
    });

    const result = await importClipioZip(file);
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].suggestedId).toBe("valid-zip-id");
  });
});
