/**
 * Tests for src/lib/sentry-content.ts
 *
 * Sentry is mocked wholesale. These tests are about the policy this module
 * implements — what gets tagged, what gets scrubbed, what is recorded, and when
 * it refuses to do anything — not about Sentry itself.
 *
 * `initSentry()` also installs a global error handler and an unhandled-rejection
 * listener, so each test resets those rather than letting one test's listeners
 * fire inside another.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks ------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getOptions: vi.fn(() => ({})),
}));

const mockScope = vi.hoisted(() => ({
  setClient: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  setExtras: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@sentry/core", async () => {
  const actual =
    await vi.importActual<typeof import("@sentry/core")>("@sentry/core");
  return {
    ...actual,
    Client: class {
      init = mockClient.init;
      captureException = mockClient.captureException;
      captureMessage = mockClient.captureMessage;
      getOptions = mockClient.getOptions;
      constructor(public _options: unknown) {}
    },
    Scope: class {
      setTag = mockScope.setTag;
      setClient = mockScope.setClient;
      setExtras = mockScope.setExtras;
      captureException = mockScope.captureException;
      captureMessage = mockScope.captureMessage;
    },
  };
});

const mockLastSentryErrorAtItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => null as string | null),
  setValue: vi.fn(async () => {}),
}));

vi.mock("~/storage/items", () => ({
  lastSentryErrorAtItem: mockLastSentryErrorAtItem,
}));

// tests/setup.ts stubs `~/lib/sentry-content` globally so the rest of the suite
// never boots a real Sentry client. This test is the exception: it exercises the
// real module, so the global stub has to be undone.
vi.mock("~/lib/sentry-content", () => import("./sentry-content"));

vi.mock("@sentry/browser", () => ({
  chromeStackLineParser: () => ({}),
  geckoStackLineParser: () => ({}),
}));

vi.mock("./sentry-relay", () => ({
  makeRelayTransport: vi.fn(() => ({})),
}));

vi.mock("./sentry-scrub", () => ({
  scrubEvent: vi.fn((e: unknown) => e),
  scrubBreadcrumb: vi.fn((b: unknown) => b),
}));

vi.mock("@/lib/sentry", () => ({ initSentry: vi.fn() }));

// initSentry() returns immediately unless a DSN is configured, so it has to be
// present before the module under test is imported. MODE stays "test", and
// WXT_SENTRY_ENABLED forces it on — otherwise `enabled` would default to false
// outside production and every init would silently no-op.
import.meta.env.WXT_SENTRY_DSN =
  "https://examplePublicKey@o0.ingest.sentry.io/0";
import.meta.env.WXT_SENTRY_ENABLED = "true";
import.meta.env.MODE = "test";

// Import after the mocks are registered.
const { captureError, captureMessage, initSentry } =
  await import("./sentry-content");

// --- helpers ----------------------------------------------------------------

describe("sentry-content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScope.setClient.mockClear();
    mockScope.captureException.mockClear();
    mockScope.captureMessage.mockClear();
    mockScope.setTag.mockClear();
    mockScope.setExtras.mockClear();
    mockClient.init.mockClear();
    mockLastSentryErrorAtItem.setValue.mockClear();
    // Default: a captured error is "long ago", so the 24h suppression is off.
    mockLastSentryErrorAtItem.getValue.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------

  describe("captureError", () => {
    it("records the error time before doing anything else", async () => {
      captureError(new Error("boom"));
      expect(mockLastSentryErrorAtItem.setValue).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
      );
    });

    it("does not throw when recording the time fails", async () => {
      mockLastSentryErrorAtItem.setValue.mockRejectedValue(
        new Error("storage down")
      );
      expect(() => captureError(new Error("boom"))).not.toThrow();
    });

    it("captures the exception through the scope", () => {
      const err = new Error("boom");
      initSentry();
      captureError(err);
      expect(mockScope.captureException).toHaveBeenCalledWith(err);
    });

    it("tags the action when one is given", () => {
      initSentry();
      captureError(new Error("boom"), { action: "save" });
      expect(mockScope.setTag).toHaveBeenCalledWith("action", "save");
    });

    it("sends remaining extras, without repeating the action as an extra", () => {
      initSentry();
      captureError(new Error("boom"), { action: "save", count: 3 });
      expect(mockScope.setExtras).toHaveBeenCalledWith({ count: 3 });
    });

    it("does not call setExtras when the action was the only extra", () => {
      initSentry();
      captureError(new Error("boom"), { action: "save" });
      // The action was extracted, leaving nothing to send.
      expect(mockScope.setExtras).not.toHaveBeenCalled();
    });

    it("does not call setExtras when no extra is given", () => {
      initSentry();
      captureError(new Error("boom"));
      expect(mockScope.setExtras).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------

  describe("captureMessage", () => {
    it("passes the message and level through", () => {
      initSentry();
      captureMessage("hello", "warning");
      expect(mockScope.captureMessage).toHaveBeenCalledWith("hello", "warning");
    });

    it("defaults the level to info", () => {
      initSentry();
      captureMessage("hello");
      expect(mockScope.captureMessage).toHaveBeenCalledWith("hello", "info");
    });

    it("forwards extras", () => {
      initSentry();
      captureMessage("hello", "info", { snippetId: "abc" });
      expect(mockScope.setExtras).toHaveBeenCalledWith({ snippetId: "abc" });
    });

    it("does not call setExtras when there are none", () => {
      initSentry();
      captureMessage("hello");
      expect(mockScope.setExtras).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------

  describe("initSentry", () => {
    it("initialises the client and attaches the scope", () => {
      initSentry();
      expect(mockClient.init).toHaveBeenCalled();
      expect(mockScope.setClient).toHaveBeenCalled();
    });

    it("is safe to call twice", () => {
      initSentry();
      expect(() => initSentry()).not.toThrow();
    });
  });
});
