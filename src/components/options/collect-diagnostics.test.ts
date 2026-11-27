/**
 * Tests for the browser-facing diagnostics collector.
 *
 * The pure builder has its own tests; these cover the boundary that matters in
 * a real install: partial failures, tab pings, and keeping a user-supplied API
 * key out of the snapshot entirely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRuntime, mockTabs } from "../../../tests/mocks/browser";

const mocks = vi.hoisted(() => ({
  getSnippets: vi.fn(),
  getStorageStatus: vi.fn(),
  getBackupInfo: vi.fn(),
  listCorruptKeys: vi.fn(),
  cachedSnippetsItem: { getValue: vi.fn() },
  debugLogItem: { getValue: vi.fn() },
  debugModeItem: { getValue: vi.fn() },
  giphyApiKeyItem: { getValue: vi.fn() },
  lastSentryErrorAtItem: { getValue: vi.fn() },
  syncDataLostItem: { getValue: vi.fn() },
  sendMessage: vi.fn(),
}));

vi.mock("@/storage", () => ({
  getSnippets: mocks.getSnippets,
  getStorageStatus: mocks.getStorageStatus,
  getBackupInfo: mocks.getBackupInfo,
  storageManager: { listCorruptKeys: mocks.listCorruptKeys },
}));

vi.mock("@/storage/items", () => ({
  cachedSnippetsItem: mocks.cachedSnippetsItem,
  debugLogItem: mocks.debugLogItem,
  debugModeItem: mocks.debugModeItem,
  giphyApiKeyItem: mocks.giphyApiKeyItem,
  lastSentryErrorAtItem: mocks.lastSentryErrorAtItem,
  syncDataLostItem: mocks.syncDataLostItem,
}));

vi.mock("@/lib/protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol")>();
  return { ...actual, sendMessage: mocks.sendMessage };
});

import { collectDiagnostics } from "./collect-diagnostics";
import { MESSAGE } from "@/lib/protocol";

const logEntry = {
  ts: Date.parse("2026-01-02T03:04:05.000Z"),
  context: "content",
  event: "expand:match",
  detail: '{"page":"https://example.com/inbox"}',
};

function seedHappyPath() {
  mocks.getStorageStatus.mockResolvedValue({
    mode: "local",
    quotaExceeded: true,
    localReason: "quota",
  });
  mocks.getSnippets.mockResolvedValue([{ id: "1" }, { id: "2" }]);
  mocks.cachedSnippetsItem.getValue.mockResolvedValue([{ id: "1" }]);
  mocks.getBackupInfo.mockResolvedValue({ snippetCount: 3 });
  mocks.listCorruptKeys.mockResolvedValue(["corrupt:snip:7"]);
  mocks.syncDataLostItem.getValue.mockResolvedValue(true);
  mocks.lastSentryErrorAtItem.getValue.mockResolvedValue(
    "2026-01-01T00:00:00.000Z"
  );
  mocks.giphyApiKeyItem.getValue.mockResolvedValue("my-private-key");
  mocks.debugModeItem.getValue.mockResolvedValue(true);
  mocks.debugLogItem.getValue.mockResolvedValue([logEntry]);
  mockRuntime.getManifest.mockReturnValue({
    name: "Clipio",
    version: "9.8.7",
    manifest_version: 3,
  });
  mockTabs.query.mockResolvedValue([
    { id: 1, url: "chrome://extensions/" },
    { id: 2, url: "https://example.com/a" },
    { id: 3, url: "https://intranet.test/b" },
    { id: undefined, url: "https://no-id.test" },
  ]);
  mocks.sendMessage.mockImplementation(
    async (_message: unknown, _data: unknown, tabId: number) =>
      tabId === 2 ? { pong: true } : Promise.reject(new Error("no listener"))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seedHappyPath();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("collectDiagnostics", () => {
  it("collects storage, log and tab health into a verified snapshot", async () => {
    const result = await collectDiagnostics("2026-01-02T03:04:05.000Z");

    expect(result.generatedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(result.version).toBe("9.8.7");
    expect(result.storage).toEqual({
      mode: "local",
      quotaExceeded: true,
      localReason: "quota",
      snippetCount: 2,
      cachedSnippetCount: 1,
      backupSnippetCount: 3,
      corruptKeys: ["corrupt:snip:7"],
      syncDataLost: true,
      lastSentryErrorAt: "2026-01-01T00:00:00.000Z",
      customGiphyKey: true,
    });
    expect(result.debugMode).toBe(true);
    expect(result.entries).toEqual([logEntry]);
    expect(result.log.total).toBe(1);
    expect(result.tabs).toEqual({
      eligible: 2,
      active: 1,
      missing: 1,
      entries: [
        { tabId: 2, host: "example.com", alive: true },
        { tabId: 3, host: "intranet.test", alive: false },
      ],
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      MESSAGE.CONTENT_PING,
      undefined,
      2
    );
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual({});
  });

  it("records the API key's presence without retaining its value", async () => {
    const result = await collectDiagnostics("now");
    expect(result.storage.customGiphyKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain("my-private-key");
  });

  it("treats an empty or whitespace key as not configured", async () => {
    mocks.giphyApiKeyItem.getValue.mockResolvedValue("   ");
    const result = await collectDiagnostics("now");
    expect(result.storage.customGiphyKey).toBe(false);
  });

  it("degrades individual failures instead of failing the whole snapshot", async () => {
    mocks.getSnippets.mockRejectedValue(new Error("sync denied"));
    mocks.getBackupInfo.mockRejectedValue("backup exploded");
    mocks.debugLogItem.getValue.mockResolvedValue({ wrong: "shape" });
    mocks.getStorageStatus.mockRejectedValue(new Error("status denied"));

    const result = await collectDiagnostics("now");

    expect(result.errors).toEqual({
      snippets: "sync denied",
      backup: "backup exploded",
      storageStatus: "status denied",
    });
    expect(result.storage.snippetCount).toBe(0);
    expect(result.storage.backupSnippetCount).toBe(0);
    expect(result.storage.mode).toBe("sync");
    expect(result.entries).toEqual([]);
  });

  it("reports a tab query failure while keeping other sources", async () => {
    mockTabs.query.mockRejectedValue(new Error("tabs permission revoked"));

    const result = await collectDiagnostics("now");

    expect(result.tabs.error).toBe("tabs permission revoked");
    expect(result.tabs.eligible).toBe(0);
    expect(result.errors.tabs).toBe("tabs permission revoked");
    expect(result.storage.snippetCount).toBe(2);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back when the manifest has no version or snippets are not an array", async () => {
    mockRuntime.getManifest.mockReturnValue({
      name: "Clipio",
      version: undefined,
      manifest_version: 3,
    } as never);
    mocks.getSnippets.mockResolvedValue({ unexpected: true });

    const result = await collectDiagnostics("now");

    expect(result.version).toBe("unknown");
    expect(result.storage.snippetCount).toBe(0);
  });
});
