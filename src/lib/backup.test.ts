/**
 * Tests for the versioned backup envelope and archive.
 *
 * These are the boundary tests: v1/v2 migration, rejection of unknown
 * versions, ZIP/manifest parsing, and the dry-run preview that must exist
 * before any restore writes.
 */

import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";

import type { MediaMetadata } from "@/storage/backends/media";
import type { Snippet } from "@/types";

import {
  BACKUP_FORMAT,
  BACKUP_MANIFEST_PATH,
  BACKUP_VERSION,
  buildBackupArchive,
  buildBackupDocument,
  backupSnippetsToParsed,
  buildBackupPreview,
  isBackupManifestTooLarge,
  MAX_BACKUP_FILE_BYTES,
  normalizeBackupEnvelope,
  parseBackupFile,
} from "./backup";

const NOW = new Date("2026-11-21T12:00:00.000Z");

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "snippet-1",
  label: "Greeting",
  shortcut: "/hello",
  content: "Hello {{cursor}}",
  tags: [],
  usageCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

const makeMeta = (overrides: Partial<MediaMetadata> = {}): MediaMetadata => ({
  id: "abc123",
  mimeType: "image/png",
  width: 10,
  height: 10,
  size: 4,
  originalSize: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

async function zipBlobToFile(
  blob: Blob,
  name = "backup.clipio.zip"
): Promise<File> {
  return new File([await blob.arrayBuffer()], name, {
    type: "application/zip",
  });
}

describe("buildBackupDocument", () => {
  it("builds a v3 envelope with the injected timestamp", () => {
    const snippet = makeSnippet();
    const media = makeMeta();
    const result = buildBackupDocument({
      snippets: [snippet],
      media: [media],
      settings: { themeMode: "dark", giphyApiKey: "secret" },
      now: NOW,
    });

    expect(result).toEqual({
      version: BACKUP_VERSION,
      format: BACKUP_FORMAT,
      exportedAt: NOW.toISOString(),
      snippets: [snippet],
      media: [media],
      settings: { themeMode: "dark" },
    });
  });

  it("does not carry a secret into the settings section", () => {
    const result = buildBackupDocument({
      snippets: [],
      media: [],
      settings: { giphyApiKey: "secret", debugLog: ["private"] },
      now: NOW,
    });

    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

describe("normalizeBackupEnvelope", () => {
  it("migrates a bare v1 snippet array with no settings", () => {
    const result = normalizeBackupEnvelope([makeSnippet()], NOW);

    expect(result.sourceVersion).toBe(1);
    expect(result.document.version).toBe(BACKUP_VERSION);
    expect(result.document.snippets).toHaveLength(1);
    expect(result.document.settings).toEqual({});
  });

  it("migrates a v2 export with media but no settings", () => {
    const result = normalizeBackupEnvelope(
      {
        version: 2,
        format: "clipio",
        exportedAt: NOW.toISOString(),
        snippets: [makeSnippet()],
        media: [makeMeta()],
      },
      NOW
    );

    expect(result.sourceVersion).toBe(2);
    expect(result.document.media).toHaveLength(1);
    expect(result.document.settings).toEqual({});
  });

  it("reads a v3 envelope and validates its settings", () => {
    const result = normalizeBackupEnvelope(
      {
        version: 3,
        format: BACKUP_FORMAT,
        exportedAt: NOW.toISOString(),
        snippets: [makeSnippet()],
        media: [],
        settings: { themeMode: "light", sidebarWidth: -10 },
      },
      NOW
    );

    expect(result.document.settings).toEqual({ themeMode: "light" });
    expect(result.settings.skipped).toEqual([
      { key: "sidebarWidth", reason: "invalid-value" },
    ]);
  });

  it("reports rejected snippets and media instead of dropping them silently", () => {
    const result = normalizeBackupEnvelope(
      {
        version: 3,
        format: BACKUP_FORMAT,
        exportedAt: NOW.toISOString(),
        snippets: [makeSnippet(), { id: "bad" }],
        media: [makeMeta(), { id: "../escape", mimeType: "text/html" }],
        settings: {},
      },
      NOW
    );

    expect(result.document.snippets).toHaveLength(1);
    expect(result.rejectedSnippets[0]?.reason).toBe("missing-label");
    expect(result.rejectedMedia).toEqual([
      { index: 1, id: "../escape", reason: "invalid-media" },
    ]);
  });

  it("falls back to the supplied time for a bad exportedAt and warns", () => {
    const result = normalizeBackupEnvelope(
      {
        version: 3,
        format: BACKUP_FORMAT,
        exportedAt: "yesterday",
        snippets: [],
        media: [],
        settings: {},
      },
      NOW
    );

    expect(result.document.exportedAt).toBe(NOW.toISOString());
    expect(result.warnings).toContain("invalid-exported-at");
  });

  it("rejects unknown formats, versions, and wrong section shapes", () => {
    expect(() =>
      normalizeBackupEnvelope({ format: "other", version: 3 })
    ).toThrow("Not a Clipio backup");
    expect(() =>
      normalizeBackupEnvelope({ format: BACKUP_FORMAT, version: 4 })
    ).toThrow("Unsupported backup version");
    expect(() =>
      normalizeBackupEnvelope({ format: "clipio", version: 5, snippets: [] })
    ).toThrow("Unsupported backup version");
    expect(() => normalizeBackupEnvelope("nope")).toThrow(
      "Backup manifest must be an object or array"
    );
    expect(() =>
      normalizeBackupEnvelope({ format: BACKUP_FORMAT, version: 3 })
    ).toThrow("Backup snippets must be an array");
    expect(() =>
      normalizeBackupEnvelope({
        format: BACKUP_FORMAT,
        version: 3,
        snippets: [],
        media: "not-an-array",
      })
    ).toThrow("Backup media must be an array");
  });

  it("reports an invalid settings section", () => {
    const result = normalizeBackupEnvelope(
      {
        version: 3,
        format: BACKUP_FORMAT,
        exportedAt: NOW.toISOString(),
        snippets: [],
        media: [],
        settings: [],
      },
      NOW
    );

    expect(result.settings.skipped).toEqual([
      { key: "settings", reason: "invalid-section" },
    ]);
  });

  it("accepts optional media metadata fields while rejecting malformed hashes", () => {
    expect(
      normalizeBackupEnvelope(
        {
          version: 3,
          format: BACKUP_FORMAT,
          exportedAt: NOW.toISOString(),
          snippets: [],
          media: [makeMeta({ alt: "A screenshot", hash: "a".repeat(64) })],
          settings: {},
        },
        NOW
      ).document.media
    ).toHaveLength(1);

    const result = normalizeBackupEnvelope(
      {
        version: 3,
        format: BACKUP_FORMAT,
        exportedAt: NOW.toISOString(),
        snippets: [],
        media: [makeMeta({ hash: "not-a-hash" })],
        settings: {},
      },
      NOW
    );
    expect(result.rejectedMedia).toHaveLength(1);
  });
});

describe("buildBackupArchive", () => {
  it("writes a v3 manifest and media blobs with the right extensions", async () => {
    const document = buildBackupDocument({
      snippets: [makeSnippet()],
      media: [
        makeMeta({ id: "png", mimeType: "image/png" }),
        makeMeta({ id: "jpg", mimeType: "image/jpeg" }),
        makeMeta({ id: "webp", mimeType: "image/webp" }),
        makeMeta({ id: "gif", mimeType: "image/gif" }),
      ],
      settings: { themeMode: "dark" },
      now: NOW,
    });
    const blobs = new Map<string, Blob>(
      ["png", "jpg", "webp", "gif"].map((id) => [id, new Blob(["data"])])
    );

    const blob = await buildBackupArchive(document, blobs);
    const buffer = await blob.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));

    expect(blob.type).toBe("application/zip");
    expect(Object.keys(unzipped)).toContain(BACKUP_MANIFEST_PATH);
    expect(Object.keys(unzipped)).toEqual(
      expect.arrayContaining([
        "media/png.png",
        "media/jpg.jpg",
        "media/webp.webp",
        "media/gif.gif",
      ])
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(unzipped[BACKUP_MANIFEST_PATH])
    );
    expect(manifest.version).toBe(3);
  });

  it("skips media metadata whose blob is missing", async () => {
    const document = buildBackupDocument({
      snippets: [],
      media: [makeMeta({ id: "missing" })],
      settings: {},
      now: NOW,
    });

    const blob = await buildBackupArchive(document, new Map());
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(unzipped)).not.toContain("media/missing.png");
  });
});

describe("parseBackupFile", () => {
  it("round-trips a v3 ZIP backup including image bytes", async () => {
    const document = buildBackupDocument({
      snippets: [makeSnippet()],
      media: [makeMeta()],
      settings: { themeMode: "dark" },
      now: NOW,
    });
    const archive = await buildBackupArchive(
      document,
      new Map([["abc123", new Blob(["image-bytes"])]])
    );
    const file = await zipBlobToFile(archive);

    const parsed = await parseBackupFile(file);

    expect(parsed.document.snippets[0]?.id).toBe("snippet-1");
    expect(parsed.document.settings).toEqual({ themeMode: "dark" });
    expect(parsed.mediaBlobs.get("abc123")?.blob.type).toBe("image/png");
    expect(await parsed.mediaBlobs.get("abc123")?.blob.text()).toBe(
      "image-bytes"
    );
    expect(parsed.missingMediaIds).toEqual([]);
  });

  it("reads a legacy JSON export", async () => {
    const json = JSON.stringify({
      version: 1,
      format: "clipio",
      exportedAt: NOW.toISOString(),
      snippets: [makeSnippet()],
    });
    const parsed = await parseBackupFile(
      new File([json], "export.json", { type: "application/json" })
    );

    expect(parsed.sourceVersion).toBe(1);
    expect(parsed.document.snippets).toHaveLength(1);
  });

  it("reads a legacy v2 export ZIP with export.json", async () => {
    const manifest = {
      version: 2,
      format: "clipio",
      exportedAt: NOW.toISOString(),
      snippets: [makeSnippet()],
      media: [makeMeta()],
    };
    // A v2 export uses `export.json`, so rebuild the archive with that entry
    // name rather than relying on the v3 builder.
    const { strToU8, zipSync } = await import("fflate");
    const legacy = new Blob([
      zipSync({
        "export.json": strToU8(JSON.stringify(manifest)),
        "media/abc123.png": new Uint8Array(
          await new Blob(["legacy"]).arrayBuffer()
        ),
      }),
    ]);

    const parsed = await parseBackupFile(await zipBlobToFile(legacy));

    expect(parsed.sourceVersion).toBe(2);
    expect(parsed.mediaBlobs.get("abc123")?.blob.type).toBe("image/png");
  });

  it("reports media referenced in the manifest but absent from the ZIP", async () => {
    const document = buildBackupDocument({
      snippets: [],
      media: [makeMeta()],
      settings: {},
      now: NOW,
    });
    const archive = await buildBackupArchive(document, new Map());

    const parsed = await parseBackupFile(await zipBlobToFile(archive));

    expect(parsed.missingMediaIds).toEqual(["abc123"]);
  });

  it("rejects oversized, invalid, and malformed files", async () => {
    // The size guard runs before arrayBuffer(), so a File-shaped object with a
    // huge declared size exercises it without allocating tens of megabytes.
    const oversized = {
      size: MAX_BACKUP_FILE_BYTES + 1,
      name: "big.zip",
    } as unknown as File;
    await expect(parseBackupFile(oversized)).rejects.toThrow("too large");

    await expect(
      parseBackupFile(new File(["not a zip"], "bad.zip"))
    ).rejects.toThrow("Invalid backup ZIP");

    await expect(
      parseBackupFile(new File(["{not json"], "bad.json"))
    ).rejects.toThrow("not valid JSON");
  });

  it("rejects a ZIP with no manifest", async () => {
    const { zipSync } = await import("fflate");
    const zip = new Blob([zipSync({ "README.txt": new Uint8Array([1]) })]);

    await expect(parseBackupFile(await zipBlobToFile(zip))).rejects.toThrow(
      "missing backup manifest"
    );
  });

  it("caps a bare JSON manifest independently of ZIP media", () => {
    expect(isBackupManifestTooLarge(1024)).toBe(false);
    expect(isBackupManifestTooLarge(9 * 1024 * 1024)).toBe(true);
  });
});

describe("buildBackupPreview", () => {
  it("gives each backup snippet a suggestedId so id collisions are detected", () => {
    expect(backupSnippetsToParsed([makeSnippet()])[0]?.suggestedId).toBe(
      "snippet-1"
    );
  });

  it("reports conflicts, settings changes, and skipped settings before restore", () => {
    // Build the raw manifest here: buildBackupDocument would already have
    // discarded the invalid setting, and the preview must report it instead.
    const settings = normalizeBackupEnvelope(
      {
        version: BACKUP_VERSION,
        format: BACKUP_FORMAT,
        exportedAt: NOW.toISOString(),
        snippets: [
          makeSnippet(),
          makeSnippet({ id: "snippet-2", shortcut: "/bye" }),
        ],
        media: [makeMeta()],
        settings: { themeMode: "dark", sidebarWidth: -1 },
      },
      NOW
    );
    const backup = {
      ...settings,
      mediaBlobs: new Map(),
      missingMediaIds: ["abc123"],
    };

    const preview = buildBackupPreview(
      backup,
      [makeSnippet({ label: "Old label" })],
      { themeMode: "light" }
    );

    expect(preview.snippetCount).toBe(2);
    expect(preview.conflictCount).toBe(1);
    expect(preview.newSnippetCount).toBe(1);
    expect(preview.conflicts[0]?.conflictType).toBe("both");
    expect(preview.settingsChanges).toEqual([
      { key: "themeMode", from: "light", to: "dark" },
    ]);
    expect(preview.settingsSkipped).toEqual([
      { key: "sidebarWidth", reason: "invalid-value" },
    ]);
    expect(preview.missingMediaCount).toBe(1);
    expect(preview.rejectedSnippetCount).toBe(0);
  });

  it("counts rejected records in the preview", () => {
    const normalized = normalizeBackupEnvelope(
      {
        version: 3,
        format: BACKUP_FORMAT,
        exportedAt: NOW.toISOString(),
        snippets: [makeSnippet(), { id: "bad" }],
        media: [{ id: "bad" }],
        settings: {},
      },
      NOW
    );
    const backup = {
      ...normalized,
      mediaBlobs: new Map(),
      missingMediaIds: [],
    };

    const preview = buildBackupPreview(backup, [], {});

    expect(preview.rejectedSnippetCount).toBe(2);
    expect(preview.conflicts).toEqual([]);
    expect(preview.settingsChanges).toEqual([]);
  });
});
