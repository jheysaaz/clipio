/**
 * Tests for src/lib/debug.ts — debugLog utility
 * spec: specs/developers-section.spec.md#debug-mode
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MAX_DEBUG_ENTRIES, _resetDebugCache, debugLog } from "./debug";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDebugModeItem, mockDebugLogItem } = vi.hoisted(() => ({
  mockDebugModeItem: {
    getValue: vi.fn().mockResolvedValue(false),
    setValue: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
  },
  mockDebugLogItem: {
    getValue: vi.fn().mockResolvedValue([]),
    setValue: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
  },
}));

vi.mock("~/storage/items", () => ({
  debugModeItem: mockDebugModeItem,
  debugLogItem: mockDebugLogItem,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function callDebugLog(
  context: "content" | "background" | "storage" = "content",
  event = "test:event",
  detail: Record<string, unknown> | string = {}
) {
  return debugLog(context, event, detail);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("debugLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the in-memory flag cache so each test starts fresh
    _resetDebugCache();
    mockDebugModeItem.getValue.mockResolvedValue(false);
    mockDebugLogItem.getValue.mockResolvedValue([]);
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDebugCache();
  });

  // spec: no-op when debug mode is off
  it("does not write to storage when debug mode is off", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(false);
    await callDebugLog();
    expect(mockDebugLogItem.setValue).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();
  });

  // spec: appends an entry when debug mode is on
  it("appends a log entry when debug mode is on", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);

    await callDebugLog("content", "expand:match", { shortcut: "/sig" });

    expect(mockDebugLogItem.setValue).toHaveBeenCalledOnce();
    const written = mockDebugLogItem.setValue.mock.calls[0][0];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      context: "content",
      event: "expand:match",
      detail: JSON.stringify({ shortcut: "/sig" }),
    });
    expect(typeof written[0].ts).toBe("number");
  });

  // spec: echoes to console.debug when debug mode is on
  it("calls console.debug when debug mode is on", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);

    await callDebugLog("background", "alarm:fired", { name: "test" });

    expect(console.debug).toHaveBeenCalledOnce();
    expect(
      (console.debug as ReturnType<typeof vi.fn>).mock.calls[0][0]
    ).toContain("[Clipio:background]");
  });

  // spec: accepts a plain string as detail
  it("stores plain string detail as-is", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);

    await callDebugLog("storage", "test:string", "raw string detail");

    const written = mockDebugLogItem.setValue.mock.calls[0][0];
    expect(written[0].detail).toBe("raw string detail");
  });

  // spec: circular buffer is capped at MAX_DEBUG_ENTRIES
  it(`caps the log buffer at ${MAX_DEBUG_ENTRIES} entries`, async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);

    // Pre-fill with MAX_DEBUG_ENTRIES entries
    const existing = Array.from({ length: MAX_DEBUG_ENTRIES }, (_, i) => ({
      ts: Date.now() - i,
      context: "content" as const,
      event: "old",
      detail: String(i),
    }));
    mockDebugLogItem.getValue.mockResolvedValue(existing);

    await callDebugLog("content", "new:event", {});

    const written = mockDebugLogItem.setValue.mock.calls[0][0];
    expect(written).toHaveLength(MAX_DEBUG_ENTRIES);
    // Oldest entry (index 0) should have been dropped
    expect(written[written.length - 1].event).toBe("new:event");
  });

  // spec: silently ignores storage read failure
  it("silently returns when storage read fails", async () => {
    mockDebugModeItem.getValue.mockRejectedValue(new Error("storage error"));
    // Should not throw
    await expect(callDebugLog()).resolves.toBeUndefined();
    expect(mockDebugLogItem.setValue).not.toHaveBeenCalled();
  });

  // spec: silently ignores storage write failure
  it("silently ignores storage write failure", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);
    mockDebugLogItem.setValue.mockRejectedValue(new Error("write error"));
    // Should not throw
    await expect(callDebugLog()).resolves.toBeUndefined();
  });
});
