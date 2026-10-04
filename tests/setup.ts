/**
 * Global Vitest setup file.
 *
 * Runs before every test file. Sets up:
 *   - browser global (WXT extension API)
 *   - crypto.randomUUID shim (available in happy-dom but made explicit)
 *   - console.error suppression for expected error paths
 */

import { vi, beforeEach, afterAll } from "vitest";
import { mockBrowser, mockChrome } from "./mocks/browser";

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

// `chrome.*` is the callback-flavoured dialect of the same APIs, and
// `@webext-core/messaging` speaks it directly. Both globals are installed
// because extension code uses `browser.*` while the messaging library uses
// `chrome.*`; they are separate mocks on purpose — see the comment on
// `mockChrome` in tests/mocks/browser.ts.
(globalThis as any).chrome = mockChrome;

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
      // Watchers are real, and fire on write.
      //
      // This used to be `watch: vi.fn(() => () => {})` — a stub that registered
      // nothing and so could never notify a subscriber. That made any behaviour
      // depending on a watch untestable: the settings store adopts a font written
      // in another extension page *through* a watcher, so with this stub the
      // cross-context path could not be exercised at all, and a test asserting
      // it failed in a way that looked like a bug in the store.
      const watchers = new Set<(v: T) => void>();
      return {
        getValue: vi.fn(async () => value),
        setValue: vi.fn(async (v: T) => {
          value = v;
          for (const watcher of watchers) watcher(v);
        }),
        removeValue: vi.fn(async () => {
          value = defaultValue;
          for (const watcher of watchers) watcher(defaultValue);
        }),
        watch: vi.fn((cb: (v: T) => void) => {
          watchers.add(cb);
          return () => {
            watchers.delete(cb);
          };
        }),
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
