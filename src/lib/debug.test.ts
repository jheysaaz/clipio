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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(console.warn).not.toHaveBeenCalled();
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

  // spec: echoes to console.warn when debug mode is on
  it("calls console.warn when debug mode is on", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);

    await callDebugLog("background", "alarm:fired", { name: "test" });

    expect(console.warn).toHaveBeenCalledOnce();
    expect(
      (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]
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

  // spec: privacy — no console output while debug mode is off
  // (folded from preview-privacy.test.ts)
  it("does not console.debug when debug mode is off", async () => {
    const consoleSpy = vi.spyOn(console, "debug");
    mockDebugModeItem.getValue.mockResolvedValue(false);

    await callDebugLog("content", "preview:filter", { count: 1 });

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(mockDebugLogItem.setValue).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // spec: privacy — detail is exactly what the caller passed (JSON-stringified),
  // never silently enriched with ambient user input
  // (folded from preview-privacy.test.ts)
  it("stores exactly the caller-provided detail with no extra fields", async () => {
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);

    await callDebugLog("content", "preview:filter", { count: 3 });

    expect(mockDebugLogItem.setValue).toHaveBeenCalledOnce();
    const written = mockDebugLogItem.setValue.mock.calls[0][0];
    expect(JSON.parse(written[0].detail)).toEqual({ count: 3 });
  });
});

/**
 * debugLog must never reject.
 *
 * This is the contract that lets every call site skip a `.catch()`. Those six
 * defensive wrappers were untestable — a swallowed rejection is invisible from
 * a test, so the handlers could be deleted with the whole suite still green —
 * so the safety was moved here, to the one place that can enforce it.
 */
describe("debugLog — never rejects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDebugCache();
    // Debug ON, so the write path is actually reached; the point of these
    // tests is that the write path cannot reject.
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDebugCache();
  });

  // The two storage paths cannot reject — ensureInitialised() and the entry
  // write each have their own try/catch — so there is nothing to assert about
  // them, and a test that "passes" for them would be decorative.
  //
  // The one vector that genuinely could reject is JSON.stringify on a detail
  // object that is circular, which sits outside both of those try/catch blocks.
  it("resolves when the detail cannot be serialised", async () => {
    // A circular detail object throws in JSON.stringify. Logging must not be
    // able to fail whatever called it.
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    await expect(
      debugLog("storage", "some:event", circular)
    ).resolves.toBeUndefined();
  });
});

/**
 * The debug-mode watcher.
 *
 * Moved here from `preview-privacy.test.ts`, which was deleted. That file named
 * a module (`preview-privacy.ts`) that does not exist, five of its six tests
 * asserted on locally-created spies rather than on any production code, and this
 * was the only one that touched real behaviour — so it is kept, in the file that
 * owns `debugLog`.
 *
 * `debugLog` is called from hot paths, so the flag read and the watcher
 * registration happen exactly once per process; a `watch` per call would
 * accumulate listeners for the lifetime of a service worker.
 *
 * The guard that actually enforces this is the `_debugEnabled !== null`
 * early-return, not the `_watching` flag: once the flag has been read,
 * `ensureInitialised` returns before reaching the watch block at all. The
 * `_watching` flag is belt-and-braces and is not independently reachable, so
 * these tests pin the observable behaviour rather than that flag.
 */
describe("debugLog — debug-mode watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDebugCache();
    mockDebugModeItem.getValue.mockResolvedValue(true);
    mockDebugLogItem.getValue.mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDebugCache();
  });

  it("registers a watcher on the first call", async () => {
    await debugLog("content", "event", {});

    expect(mockDebugModeItem.watch).toHaveBeenCalledTimes(1);
  });

  it("does not register a second watcher on later calls", async () => {
    // Once-per-process registration.
    await debugLog("content", "one", {});
    await debugLog("content", "two", {});
    await debugLog("storage", "three", {});

    expect(mockDebugModeItem.watch).toHaveBeenCalledTimes(1);
  });

  it("registers a watcher again after the cache is reset", async () => {
    // A fresh process (a restarted service worker) must re-establish it, or the
    // debug toggle would stop taking effect until the next extension update.
    await debugLog("content", "one", {});
    _resetDebugCache();
    await debugLog("content", "two", {});

    expect(mockDebugModeItem.watch).toHaveBeenCalledTimes(2);
  });

  it("registers the watcher even when debug mode is off", async () => {
    // Otherwise turning the toggle on would never be observed.
    mockDebugModeItem.getValue.mockResolvedValue(false);
    _resetDebugCache();

    await debugLog("content", "event", {});

    expect(mockDebugModeItem.watch).toHaveBeenCalledTimes(1);
  });
});
