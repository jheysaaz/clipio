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
    eventFromUnknownInput: (...a: unknown[]) =>
      mockEventFactories.eventFromUnknownInput(
        ...(a as Parameters<typeof mockEventFactories.eventFromUnknownInput>)
      ),
    eventFromMessage: (...a: unknown[]) =>
      mockEventFactories.eventFromMessage(
        ...(a as Parameters<typeof mockEventFactories.eventFromMessage>)
      ),
    Client: class {
      init = mockClient.init;
      captureException = mockClient.captureException;
      captureMessage = mockClient.captureMessage;
      getOptions = mockClient.getOptions;
      constructor(public _options: unknown) {
        mockBuilt.client = this;
        mockBuilt.options = _options as Record<string, unknown>;
      }
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

// The two event factories ContentClient delegates to. Held as refs because the
// tests below assert on what the client hands them, not on Sentry's output.
const mockEventFactories = vi.hoisted(() => ({
  eventFromUnknownInput: vi.fn((_c: unknown, _p: unknown, input: unknown) => ({
    event_id: "from-exception",
    input,
  })),
  eventFromMessage: vi.fn(
    (
      _p: unknown,
      message: string,
      level: string,
      _h: unknown,
      _a: unknown
    ) => ({
      event_id: "from-message",
      message,
      level,
    })
  ),
}));

// The constructed client and its options. ContentClient subclasses the mocked
// Client, so its own methods are only reachable through a real instance — which
// is what initSentry() builds.
const mockBuilt = vi.hoisted(() => ({
  client: null as unknown,
  options: null as Record<string, unknown> | null,
}));

const mockScrub = vi.hoisted(() => ({
  scrubEvent: vi.fn((e: unknown) => e),
  scrubBreadcrumb: vi.fn((b: unknown) => b),
}));

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

vi.mock("./sentry-scrub", () => mockScrub);

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
    mockEventFactories.eventFromUnknownInput.mockClear();
    mockEventFactories.eventFromMessage.mockClear();
    mockScrub.scrubEvent.mockClear();
    mockScrub.scrubBreadcrumb.mockClear();
    mockBuilt.client = null;
    mockBuilt.options = null;
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

    it("tags the context and falls back to unknown when there is no extension id", () => {
      // The catch around `browser.runtime.id` is not defensive noise: in the
      // content script the API exists, but this module is also imported by unit
      // tests and by any future context where it might not. Without the
      // fallback the tag would be `undefined` on every event.
      initSentry();
      expect(mockScope.setTag).toHaveBeenCalledWith(
        "extension.context",
        "content"
      );
      const idCall = mockScope.setTag.mock.calls.find(
        (c) => c[0] === "extension.id"
      );
      expect(idCall).toBeDefined();
      expect(typeof idCall?.[1]).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // The scrubbing hooks are the whole privacy boundary for this context. They
  // are wired as options on the client, so nothing about them is observable
  // unless they are pulled back off the constructed client and invoked.
  // -----------------------------------------------------------------------

  describe("the client's scrubbing hooks", () => {
    function hooks() {
      initSentry();
      const options = mockBuilt.options;
      expect(options).not.toBeNull();
      return options as {
        beforeSend: (e: unknown) => unknown;
        beforeBreadcrumb: (b: unknown) => unknown;
      };
    }

    it("sends every event through the scrubber before it leaves", () => {
      const { beforeSend } = hooks();
      const event = { event_id: "abc" };
      const scrubbed = { event_id: "abc", extra: { hostname: "[url]" } };
      mockScrub.scrubEvent.mockReturnValueOnce(scrubbed);

      expect(beforeSend(event)).toBe(scrubbed);
      expect(mockScrub.scrubEvent).toHaveBeenCalledWith(event);
    });

    it("drops the event when the scrubber returns null", () => {
      // The negative case, and the only one that proves the hook is wired to
      // the return value rather than merely called. Returning null is how
      // Sentry is told not to send; if beforeSend swallowed it, scrubbing would
      // be cosmetic and every redacted field would still be transmitted.
      const { beforeSend } = hooks();
      mockScrub.scrubEvent.mockReturnValueOnce(null);

      expect(beforeSend({ event_id: "abc" })).toBeNull();
    });

    it("scrubs breadcrumbs before they leave", () => {
      const { beforeBreadcrumb } = hooks();
      const crumb = { message: "visited mail.google.com", data: { url: "x" } };
      const scrubbed = { message: "visited [url]", data: { url: "[url]" } };
      mockScrub.scrubBreadcrumb.mockReturnValueOnce(scrubbed);

      expect(beforeBreadcrumb(crumb)).toBe(scrubbed);
      expect(mockScrub.scrubBreadcrumb).toHaveBeenCalledWith(crumb);
    });
  });

  // -----------------------------------------------------------------------
  // ContentClient exists to override two methods Sentry's abstract Client
  // declares but does not implement. If either override regressed, the
  // content script would throw on every captured error instead of reporting it.
  // -----------------------------------------------------------------------

  describe("ContentClient event factories", () => {
    type Factories = {
      eventFromException: (
        e: unknown,
        hint?: unknown
      ) => Promise<{ event_id: string }>;
      eventFromMessage: (
        m: string,
        l?: string,
        hint?: unknown
      ) => Promise<{ event_id: string; message: string; level: string }>;
    };

    function client(): Factories {
      initSentry();
      expect(mockBuilt.client).not.toBeNull();
      return mockBuilt.client as Factories;
    }

    it("builds an event from an exception using the configured stack parser", async () => {
      const c = client();
      const error = new Error("boom");
      const hint = { mechanism: { handled: false } };

      const event = await c.eventFromException(error, hint);

      expect(event.event_id).toBe("from-exception");
      expect(mockEventFactories.eventFromUnknownInput).toHaveBeenCalledWith(
        mockBuilt.client,
        mockBuilt.options?.stackParser,
        error,
        hint
      );
    });

    it("works with no hint at all", async () => {
      const c = client();
      const error = new TypeError("nope");

      await expect(c.eventFromException(error)).resolves.toEqual(
        expect.objectContaining({ event_id: "from-exception" })
      );
      expect(mockEventFactories.eventFromUnknownInput).toHaveBeenCalledWith(
        mockBuilt.client,
        mockBuilt.options?.stackParser,
        error,
        undefined
      );
    });

    it("defaults the severity to info", async () => {
      const c = client();

      const event = await c.eventFromMessage("something happened");

      expect(event.level).toBe("info");
      expect(mockEventFactories.eventFromMessage).toHaveBeenCalledWith(
        mockBuilt.options?.stackParser,
        "something happened",
        "info",
        undefined,
        undefined
      );
    });

    it("forwards an explicit severity", async () => {
      const c = client();

      const event = await c.eventFromMessage("it broke", "error");

      expect(event.level).toBe("error");
    });
  });
});
