/**
 * Tests for src/lib/exporters/clipio.ts
 * spec: specs/exporters.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  buildClipioExport,
  buildClipioExportV2,
  snippetsContainMedia,
  extractMediaIds,
  buildClipioZip,
} from "./clipio";
import type { Snippet } from "~/types";
import type { MediaMetadata } from "~/storage/backends/media";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "test-id",
  label: "Test",
  shortcut: "ts",
  content: "Test content",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

const makeMeta = (overrides: Partial<MediaMetadata> = {}): MediaMetadata => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  mimeType: "image/webp",
  width: 100,
  height: 100,
  size: 1024,
  originalSize: 2048,
  createdAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("buildClipioExport", () => {
  // spec: MUST return an object with version set to the literal 1
  it("sets version to 1", () => {
    const result = buildClipioExport([]);
    expect(result.version).toBe(1);
  });

  // spec: MUST return an object with format set to the literal "clipio"
  it('sets format to "clipio"', () => {
    const result = buildClipioExport([]);
    expect(result.format).toBe("clipio");
  });

  // spec: MUST set exportedAt to a valid ISO 8601 timestamp
  it("sets exportedAt to a valid ISO date string", () => {
    const result = buildClipioExport([]);
    const parsed = new Date(result.exportedAt);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it("sets exportedAt to a string that looks like an ISO timestamp", () => {
    const result = buildClipioExport([]);
    expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // spec: MUST pass the snippets array through unchanged
  it("passes the snippets array through", () => {
    const snippets = [makeSnippet({ id: "a" }), makeSnippet({ id: "b" })];
    const result = buildClipioExport(snippets);
    expect(result.snippets).toEqual(snippets);
  });

  // spec: MUST work correctly with an empty snippets array
  it("works with an empty snippets array", () => {
    const result = buildClipioExport([]);
    expect(result.snippets).toEqual([]);
  });

  // spec: MUST NOT mutate the input snippets array
  it("does not mutate the input array", () => {
    const snippets = [makeSnippet()];
    const originalLength = snippets.length;
    buildClipioExport(snippets);
    expect(snippets.length).toBe(originalLength);
  });

  // spec: result is a valid ClipioExport shape
  it("returns the correct envelope shape", () => {
    const snippets = [makeSnippet()];
    const result = buildClipioExport(snippets);
    expect(result).toMatchObject({
      version: 1,
      format: "clipio",
      snippets,
    });
    expect(typeof result.exportedAt).toBe("string");
  });

  // spec: exportedAt reflects the time of the call (within a reasonable window)
  it("sets exportedAt close to the current time", () => {
    const before = Date.now();
    const result = buildClipioExport([]);
    const after = Date.now();
    const exportedTime = new Date(result.exportedAt).getTime();
    expect(exportedTime).toBeGreaterThanOrEqual(before);
    expect(exportedTime).toBeLessThanOrEqual(after);
  });
});

describe("buildClipioExportV2", () => {
  it("sets version to 2", () => {
    const result = buildClipioExportV2([], []);
    expect(result.version).toBe(2);
  });

  it('sets format to "clipio"', () => {
    const result = buildClipioExportV2([], []);
    expect(result.format).toBe("clipio");
  });

  it("includes media metadata array", () => {
    const media = [makeMeta()];
    const result = buildClipioExportV2([], media);
    expect(result.media).toEqual(media);
  });

  it("passes snippets through unchanged", () => {
    const snippets = [makeSnippet({ id: "x" })];
    const result = buildClipioExportV2(snippets, []);
    expect(result.snippets).toEqual(snippets);
  });

  it("sets exportedAt to a valid ISO timestamp", () => {
    const result = buildClipioExportV2([], []);
    expect(new Date(result.exportedAt).getTime()).not.toBeNaN();
  });
});

describe("snippetsContainMedia", () => {
  it("returns false when no snippets contain image placeholders", () => {
    const snippets = [
      makeSnippet({ content: "Hello world" }),
      makeSnippet({ content: "{{clipboard}}" }),
      makeSnippet({ content: "{{gif:abc123}}" }),
    ];
    expect(snippetsContainMedia(snippets)).toBe(false);
  });

  it("returns true when a snippet contains an image placeholder", () => {
    const snippets = [
      makeSnippet({
        content: "Hello {{image:550e8400-e29b-41d4-a716-446655440000}} world",
      }),
    ];
    expect(snippetsContainMedia(snippets)).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(snippetsContainMedia([])).toBe(false);
  });

  it("returns true if any (not all) snippets contain images", () => {
    const snippets = [
      makeSnippet({ content: "plain text", id: "a" }),
      makeSnippet({
        content: "{{image:550e8400-e29b-41d4-a716-446655440000}}",
        id: "b",
      }),
    ];
    expect(snippetsContainMedia(snippets)).toBe(true);
  });

  it("returns true for width-suffixed image placeholder {{image:uuid:320}}", () => {
    const snippets = [
      makeSnippet({
        content: "{{image:550e8400-e29b-41d4-a716-446655440000:320}}",
      }),
    ];
    expect(snippetsContainMedia(snippets)).toBe(true);
  });
});

describe("extractMediaIds", () => {
  it("returns empty array when no images are referenced", () => {
    expect(extractMediaIds([makeSnippet({ content: "no images" })])).toEqual(
      []
    );
  });

  it("extracts a single image ID", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const snippets = [makeSnippet({ content: `Hello {{image:${id}}}` })];
    expect(extractMediaIds(snippets)).toEqual([id]);
  });

  it("deduplicates repeated image IDs", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const snippets = [
      makeSnippet({ content: `{{image:${id}}} and {{image:${id}}}`, id: "s1" }),
    ];
    expect(extractMediaIds(snippets)).toEqual([id]);
  });

  it("collects IDs from multiple snippets", () => {
    const id1 = "550e8400-e29b-41d4-a716-446655440000";
    const id2 = "660e8400-e29b-41d4-a716-446655440001";
    const snippets = [
      makeSnippet({ content: `{{image:${id1}}}`, id: "s1" }),
      makeSnippet({ content: `{{image:${id2}}}`, id: "s2" }),
    ];
    const result = extractMediaIds(snippets);
    expect(result).toContain(id1);
    expect(result).toContain(id2);
    expect(result).toHaveLength(2);
  });

  it("does not extract gif IDs", () => {
    const snippets = [makeSnippet({ content: "{{gif:abc123XYZ}}" })];
    expect(extractMediaIds(snippets)).toEqual([]);
  });

  it("extracts UUID from width-suffixed placeholder {{image:uuid:200}}", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const snippets = [makeSnippet({ content: `{{image:${id}:200}}` })];
    expect(extractMediaIds(snippets)).toEqual([id]);
  });
});

describe("buildClipioZip", () => {
  it("returns a Blob", async () => {
    const exportData = buildClipioExportV2([], []);
    const result = await buildClipioZip(exportData, new Map());
    expect(result).toBeInstanceOf(Blob);
  });

  it("returns a ZIP content type", async () => {
    const exportData = buildClipioExportV2([], []);
    const result = await buildClipioZip(exportData, new Map());
    expect(result.type).toBe("application/zip");
  });

  it("produces a non-empty ZIP even with no media", async () => {
    const exportData = buildClipioExportV2([makeSnippet()], []);
    const result = await buildClipioZip(exportData, new Map());
    expect(result.size).toBeGreaterThan(0);
  });

  it("includes export.json in the ZIP", async () => {
    const { unzipSync } = await import("fflate");
    const exportData = buildClipioExportV2([makeSnippet()], []);
    const blob = await buildClipioZip(exportData, new Map());
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(unzipped)).toContain("export.json");
  });

  it("export.json contains valid ClipioExport v2 JSON", async () => {
    const { unzipSync } = await import("fflate");
    const snippets = [makeSnippet({ id: "snap-1" })];
    const exportData = buildClipioExportV2(snippets, []);
    const blob = await buildClipioZip(exportData, new Map());
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    const json = new TextDecoder().decode(unzipped["export.json"]);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(parsed.format).toBe("clipio");
    expect(parsed.snippets[0].id).toBe("snap-1");
  });

  it("includes media blobs as media/<id>.<ext>", async () => {
    const { unzipSync } = await import("fflate");
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const meta = makeMeta({ id, mimeType: "image/webp" });
    const exportData = buildClipioExportV2([], [meta]);
    const fakeBlob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], {
      type: "image/webp",
    });
    const blobs = new Map([[id, fakeBlob]]);
    const blob = await buildClipioZip(exportData, blobs);
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(unzipped)).toContain(`media/${id}.webp`);
  });

  it("skips media entries whose blob is not in the map", async () => {
    const { unzipSync } = await import("fflate");
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const meta = makeMeta({ id });
    const exportData = buildClipioExportV2([], [meta]);
    const blob = await buildClipioZip(exportData, new Map()); // empty map
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(unzipped)).not.toContain(`media/${id}.webp`);
  });

  it("uses .jpg extension for image/jpeg blobs", async () => {
    const { unzipSync } = await import("fflate");
    const id = "550e8400-e29b-41d4-a716-446655440001";
    const meta = makeMeta({ id, mimeType: "image/jpeg" });
    const exportData = buildClipioExportV2([], [meta]);
    const fakeBlob = new Blob([new Uint8Array([0xff, 0xd8])], {
      type: "image/jpeg",
    });
    const blob = await buildClipioZip(exportData, new Map([[id, fakeBlob]]));
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(unzipped)).toContain(`media/${id}.jpg`);
  });

  it("uses .gif extension for image/gif blobs", async () => {
    const { unzipSync } = await import("fflate");
    const id = "550e8400-e29b-41d4-a716-446655440002";
    const meta = makeMeta({ id, mimeType: "image/gif" });
    const exportData = buildClipioExportV2([], [meta]);
    const fakeBlob = new Blob([new Uint8Array([0x47, 0x49, 0x46])], {
      type: "image/gif",
    });
    const blob = await buildClipioZip(exportData, new Map([[id, fakeBlob]]));
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(unzipped)).toContain(`media/${id}.gif`);
  });

  it("uses .png extension for image/png blobs (default branch)", async () => {
    const { unzipSync } = await import("fflate");
    const id = "550e8400-e29b-41d4-a716-446655440003";
    const meta = makeMeta({ id, mimeType: "image/png" });
    const exportData = buildClipioExportV2([], [meta]);
    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    const blob = await buildClipioZip(exportData, new Map([[id, fakeBlob]]));
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(unzipped)).toContain(`media/${id}.png`);
  });
});
