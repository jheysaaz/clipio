/**
 * Global Vitest setup file.
 *
 * Runs before every test file. Sets up:
 *   - browser global (WXT extension API)
 *   - crypto.randomUUID shim (available in happy-dom but made explicit)
 *   - console.error suppression for expected error paths
 */

import { vi, beforeEach } from "vitest";
import { mockBrowser } from "./mocks/browser";

// ---------------------------------------------------------------------------
// browser global — WXT and all extension code references `browser.*`
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).browser = mockBrowser;

// ---------------------------------------------------------------------------
// wxt/utils/storage mock — storage items use WXT's typed storage API.
// We provide a minimal mock so imports of items.ts don't crash.
// Individual test files that test storage behavior should use
// createMockStorageItem() from tests/mocks/browser.ts for fine-grained control.
// ---------------------------------------------------------------------------

vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: vi.fn(<T>(_key: string, options?: { defaultValue?: T }) => {
      const defaultValue = options?.defaultValue as T;
      let value = defaultValue;
      return {
        getValue: vi.fn(async () => value),
        setValue: vi.fn(async (v: T) => {
          value = v;
        }),
        removeValue: vi.fn(async () => {
          value = defaultValue;
        }),
        watch: vi.fn(() => () => {}),
      };
    }),
  },
}));

// ---------------------------------------------------------------------------
// Sentry mock — prevent real Sentry calls during tests
// ---------------------------------------------------------------------------

vi.mock("~/lib/sentry", () => ({
  initSentry: vi.fn(),
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("~/lib/sentry-relay", () => ({
  makeRelayTransport: vi.fn(),
}));

// ---------------------------------------------------------------------------
// canvas-confetti mock — content script imports this
// ---------------------------------------------------------------------------

vi.mock("canvas-confetti", () => ({
  default: Object.assign(vi.fn(), { create: vi.fn(() => vi.fn()) }),
}));

// ---------------------------------------------------------------------------
// Suppress expected console noise in tests
// (Only suppress specific well-known messages — keep unexpected errors visible)
// ---------------------------------------------------------------------------

const SUPPRESSED_PREFIXES = [
  "[Clipio]",
  "Failed to get usage counts",
  "Failed to increment",
  "Failed to reset",
  "Failed to clear",
];

const originalConsoleError = console.error;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = String(args[0] ?? "");
    if (SUPPRESSED_PREFIXES.some((prefix) => message.startsWith(prefix))) {
      return;
    }
    originalConsoleError(...args);
  });
});
