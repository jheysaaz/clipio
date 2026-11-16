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
    /**
     * Key-aware, and backed by the real storage area rather than a closure.
     *
     * Both properties are load-bearing, and both were learned the hard way.
     *
     * **Key-aware.** This used to ignore the key entirely, which hid a real bug:
     * `settings.ts` reads `storage.local` directly to tell an absent theme key
     * from one set to its default, and looked up `"local:themeMode"` where WXT
     * had written `"themeMode"`. No test could tell the two apart, so the store
     * silently resolved `"system"` for every user while the Appearance select
     * read "Dark". WXT splits the key on the first colon — the prefix selects the
     * storage *area*, the remainder is the key inside it — so the mock does the
     * same.
     *
     * **Area-backed.** It used to hold the value in a closure. Real WXT storage
     * holds nothing: every read goes to `browser.storage.local`. A closure loses
     * its value when `vi.resetModules()` discards the module registry, which
     * meant a test could seed through one module instance and read through
     * another and see a default — a divergence that looks exactly like the bug
     * it was hiding. Watchers are still tracked here, because the area does not.
     */
    defineItem: vi.fn(<T>(_key: string, options?: { defaultValue?: T }) => {
      const defaultValue = options?.defaultValue as T;
      const driverKey = _key.split(":").slice(1).join(":") || _key;
      const watchers = new Set<(v: T) => void>();

      type LocalArea = {
        get: (key: string) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
        remove: (key: string) => Promise<void>;
      };
      const local = () =>
        (
          globalThis as unknown as {
            browser: { storage: { local: LocalArea } };
          }
        ).browser.storage.local;

      return {
        getValue: vi.fn(async (): Promise<T> => {
          const raw = (await local().get(driverKey))[driverKey];
          return (raw === undefined ? defaultValue : raw) as T;
        }),
        setValue: vi.fn(async (v: T) => {
          await local().set({ [driverKey]: v });
          for (const watcher of watchers) watcher(v);
        }),
        // A real remove leaves the key absent rather than writing the default
        // back — which is what the presence probe in settings.ts relies on.
        removeValue: vi.fn(async () => {
          await local().remove(driverKey);
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
