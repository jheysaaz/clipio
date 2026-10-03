/**
 * Global Vitest setup file.
 *
 * Runs before every test file. Sets up:
 *   - browser global (WXT extension API)
 *   - crypto.randomUUID shim (available in happy-dom but made explicit)
 *   - console.error suppression for expected error paths
 */

import { vi, beforeEach, afterAll } from "vitest";
import { mockBrowser } from "./mocks/browser";

// jest-dom matchers (toBeInTheDocument, toHaveValue, …) are available in every
// test file. Imported here rather than per-file because a component test that
// forgets them fails with "expected undefined to be in the document", which
// reads like a rendering bug rather than a missing import.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount anything a component test rendered. Without this, components stay in
// the document between tests and queries match nodes from a previous render —
// which passes for the wrong reason and breaks on reordering.
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// browser global — WXT and all extension code references `browser.*`
// ---------------------------------------------------------------------------

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

vi.mock("~/lib/sentry-content", () => ({
  initSentry: vi.fn(),
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("~/lib/sentry-relay", () => ({
  makeRelayTransport: vi.fn(),
  registerSentryRelayListener: vi.fn(),
  SENTRY_RELAY_MESSAGE_TYPE: "sentry-relay",
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

// Captured once, before any spying, so the forwarding target is always the
// pristine implementation rather than a previously-installed mock.
const originalConsoleError = console.error;

beforeEach(() => {
  // vitest's spyOn is idempotent: if console.error is already a mock it is
  // reused rather than re-wrapped, so this does not stack across tests.
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = String(args[0] ?? "");
    if (SUPPRESSED_PREFIXES.some((prefix) => message.startsWith(prefix))) {
      return;
    }
    originalConsoleError(...args);
  });
});

afterAll(() => {
  // Hand console.error back so this global setup file does not leave the
  // method mocked after the test file that loaded it has finished.
  vi.restoreAllMocks();
});
