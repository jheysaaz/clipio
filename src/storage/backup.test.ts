/**
 * Storage side of backup/restore.
 *
 * The tests prove that only allowlisted settings are read, that a failed
 * setting write is non-fatal, and that a confirmed restore writes snippets
 * and media through the existing storage seams.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

import { BACKUP_MANIFEST_PATH, normalizeBackupEnvelope } from "@/lib/backup";
import type { MediaMetadata } from "@/storage/backends/media";
import type { Snippet } from "@/types";
import { resetBrowserMocks, mockStorageLocal } from "../../tests/mocks/browser";

const mocks = vi.hoisted(() => ({
  getSnippets: vi.fn(),
  bulkSaveSnippets: vi.fn(),
  getMedia: vi.fn(),
  listMedia: vi.fn(),
  restoreMediaEntry: vi.fn(),
}));

vi.mock("./index", () => ({
  getSnippets: mocks.getSnippets,
  bulkSaveSnippets: mocks.bulkSaveSnippets,
}));

vi.mock("./backends/media", () => ({
  getMedia: mocks.getMedia,
  listMedia: mocks.listMedia,
  restoreMediaEntry: mocks.restoreMediaEntry,
}));

import {
  applyBackupSettings,
  createBackupFile,
  downloadBackup,
  readBackupSettings,
  restoreBackup,
} from "./backup";

const NOW = new Date("2026-11-21T12:00:00.000Z");

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "snippet-1",
  label: "Greeting",
  shortcut: "/hello",
  content: "Hello",
  tags: [],
  usageCount: 0,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...overrides,
});

const makeMeta = (overrides: Partial<MediaMetadata> = {}): MediaMetadata => ({
  id: "image-1",
  mimeType: "image/png",
  width: 10,
  height: 10,
  size: 4,
  originalSize: 4,
  createdAt: NOW.toISOString(),
  ...overrides,
});

function parsedBackup(overrides: Record<string, unknown> = {}) {
  return normalizeBackupEnvelope(
    {
      version: 3,
      format: "clipio-backup",
      exportedAt: NOW.toISOString(),
      snippets: [makeSnippet()],
      media: [makeMeta()],
      settings: { themeMode: "dark" },
      ...overrides,
    },
    NOW
  );
}

beforeEach(() => {
  resetBrowserMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.getSnippets.mockReset().mockResolvedValue([makeSnippet()]);
  mocks.bulkSaveSnippets.mockReset().mockResolvedValue(undefined);
  mocks.listMedia.mockReset().mockResolvedValue([makeMeta()]);
  mocks.getMedia.mockReset().mockResolvedValue({
    ...makeMeta(),
    blob: new Blob(["image"]),
  });
  mocks.restoreMediaEntry.mockReset().mockResolvedValue("image-1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("readBackupSettings", () => {
  it("reads only allowlisted raw keys", async () => {
    await browser.storage.local.set({
      themeMode: "dark",
      sidebarOpen: false,
      giphyApiKey: "secret",
      debugLog: ["private"],
      futureSetting: true,
    });

    const result = await readBackupSettings();

    expect(result).toEqual({ themeMode: "dark", sidebarOpen: false });
    expect(result).not.toHaveProperty("giphyApiKey");
  });
});

describe("createBackupFile", () => {
  it("builds a v3 ZIP from snippets, settings, and all media", async () => {
    const { blob, fileName } = await createBackupFile();

    expect(fileName).toBe("clipio-backup-2026-11-21.clipio.zip");
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(
      new TextDecoder().decode(unzipped[BACKUP_MANIFEST_PATH])
    );
    expect(manifest.version).toBe(3);
    expect(manifest.snippets[0].id).toBe("snippet-1");
    expect(manifest.settings).toEqual({});
    expect(Object.keys(unzipped)).toContain("media/image-1.png");
  });

  it("keeps media metadata even when the blob could not be read", async () => {
    mocks.getMedia.mockResolvedValue(null);

    const { blob } = await createBackupFile();
    const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(unzipped)).not.toContain("media/image-1.png");
    expect(mocks.listMedia).toHaveBeenCalled();
  });
});

describe("downloadBackup", () => {
  it("creates a download anchor and revokes its object URL", () => {
    const click = vi.fn();
    const anchor = {
      click,
      download: "",
      href: "",
    } as unknown as HTMLAnchorElement;
    const createElement = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor);
    const createObjectURL = vi.fn(() => "blob:backup");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    downloadBackup(new Blob(["zip"]), "backup.clipio.zip");

    expect(anchor.download).toBe("backup.clipio.zip");
    expect(anchor.href).toBe("blob:backup");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    createElement.mockRestore();
  });
});

describe("applyBackupSettings", () => {
  it("applies valid keys and skips invalid ones", async () => {
    const result = await applyBackupSettings({
      themeMode: "dark",
      sidebarWidth: -1,
    });

    expect(result).toEqual({
      applied: ["themeMode"],
      failed: [{ key: "sidebarWidth", reason: "invalid-value" }],
    });
    expect(await browser.storage.local.get("themeMode")).toEqual({
      themeMode: "dark",
    });
  });

  it("continues after a failed write", async () => {
    mockStorageLocal.set.mockRejectedValueOnce(new Error("quota"));
    const result = await applyBackupSettings({
      themeMode: "dark",
      confettiEnabled: false,
    });

    expect(result.applied).toEqual(["confettiEnabled"]);
    expect(result.failed).toEqual([
      { key: "themeMode", reason: "write-failed" },
    ]);
  });
});

describe("restoreBackup", () => {
  it("writes settings before snippets and reports restored media", async () => {
    const normalized = parsedBackup();
    const backup = {
      ...normalized,
      mediaBlobs: new Map([
        ["image-1", { blob: new Blob(["image"]), meta: makeMeta() }],
      ]),
      missingMediaIds: [],
    };
    const order: string[] = [];
    mockStorageLocal.set.mockImplementation(async () => {
      order.push("settings");
    });
    mocks.bulkSaveSnippets.mockImplementation(async () => {
      order.push("snippets");
    });

    const result = await restoreBackup(backup, [], []);

    expect(order).toEqual(["settings", "snippets"]);
    expect(result).toEqual({
      snippetCount: 1,
      settingsApplied: ["themeMode"],
      settingsFailed: [],
      mediaRestored: 1,
      mediaFailed: [],
    });
    expect(mocks.restoreMediaEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: "image-1" })
    );
  });

  it("re-points snippet placeholders at the surviving blob after dedup", async () => {
    // A same-hash blob survives under an older id. Restoring must not leave the
    // restored snippet referencing an id that was never stored.
    mocks.restoreMediaEntry.mockResolvedValueOnce("existing-id");
    const normalized = parsedBackup({
      snippets: [
        makeSnippet({ content: "before {{image:image-1:120}} after" }),
      ],
    });
    const backup = {
      ...normalized,
      mediaBlobs: new Map([
        ["image-1", { blob: new Blob(["image"]), meta: makeMeta() }],
      ]),
      missingMediaIds: [],
    };

    await restoreBackup(backup, [], []);

    expect(mocks.bulkSaveSnippets).toHaveBeenCalledWith([
      expect.objectContaining({
        content: "before {{image:existing-id:120}} after",
      }),
    ]);
  });

  it("applies conflict resolutions to the final snippet list", async () => {
    const normalized = parsedBackup({
      snippets: [makeSnippet({ content: "New content" })],
    });
    const backup = {
      ...normalized,
      mediaBlobs: new Map(),
      missingMediaIds: [],
    };
    const conflict = {
      incoming: {
        suggestedId: "snippet-1",
        label: "Greeting",
        shortcut: "/hello",
        content: "New content",
        tags: [],
        unsupportedPlaceholders: [],
      },
      existing: makeSnippet({ content: "Old content" }),
      conflictType: "both" as const,
      resolution: "overwrite" as const,
      renamedShortcut: "/hello",
    };

    await restoreBackup(backup, [conflict], [conflict.existing]);

    expect(mocks.bulkSaveSnippets).toHaveBeenCalledWith([
      expect.objectContaining({ id: "snippet-1", content: "New content" }),
    ]);
  });

  it("reports media failures without losing the settings report", async () => {
    mocks.restoreMediaEntry.mockRejectedValueOnce(new Error("too large"));
    const normalized = parsedBackup({
      settings: { themeMode: "dark", sidebarWidth: -1 },
    });
    const backup = {
      ...normalized,
      mediaBlobs: new Map([
        ["image-1", { blob: new Blob(["image"]), meta: makeMeta() }],
      ]),
      missingMediaIds: [],
    };

    const result = await restoreBackup(backup, [], [makeSnippet()]);

    expect(result.mediaRestored).toBe(0);
    expect(result.mediaFailed).toEqual([{ id: "image-1", error: "too large" }]);
    expect(result.settingsFailed).toEqual([
      { key: "sidebarWidth", reason: "invalid-value" },
    ]);
  });
});
