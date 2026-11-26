/**
 * Regression coverage for the Sentry integrations chosen per extension context.
 *
 * The browser-tracing integration starts web-vitals observers that read
 * `document` from a microtask. An MV3 service worker has no document, so an
 * enabled Sentry client in the background produced an unhandled ReferenceError
 * on startup. These tests assert the integration list rather than "does not
 * throw": the failure escaped as an unhandled promise rejection, which a
 * synchronous try/catch around initSentry() would not have caught.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  browserTracingCalls: 0,
}));

vi.mock("~/lib/sentry", () => import("./sentry"));

vi.mock("@sentry/browser", async () => {
  const actual =
    await vi.importActual<typeof import("@sentry/browser")>("@sentry/browser");
  return {
    ...actual,
    BrowserClient: class {
      init = vi.fn();
      constructor(options: unknown) {
        mocks.options = options as Record<string, unknown>;
      }
    },
    Scope: class {
      setTag = vi.fn();
      setClient = vi.fn();
      setExtras = vi.fn();
      captureException = vi.fn();
      captureMessage = vi.fn();
    },
    browserTracingIntegration: () => {
      mocks.browserTracingCalls += 1;
      return { name: "BrowserTracing" };
    },
  };
});

vi.mock("./sentry-scrub", () => ({
  scrubEvent: (event: unknown) => event,
  scrubBreadcrumb: (breadcrumb: unknown) => breadcrumb,
}));

vi.mock("~/storage/items", () => ({
  lastSentryErrorAtItem: {
    getValue: vi.fn(async () => null),
    setValue: vi.fn(async () => {}),
  },
}));

const { initSentry } = await import("./sentry");

const DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
const ENV_KEYS = [
  "WXT_SENTRY_DSN",
  "WXT_SENTRY_ENABLED",
  "WXT_SENTRY_RELEASE",
  "MODE",
] as const;

function integrationNames(): string[] {
  expect(Array.isArray(mocks.options?.integrations)).toBe(true);
  return (mocks.options?.integrations as Array<{ name: string }>).map(
    (integration) => integration.name
  );
}

describe("sentry integration selection", () => {
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = Object.fromEntries(
      ENV_KEYS.map((key) => [key, import.meta.env[key]])
    );
    mocks.options = null;
    mocks.browserTracingCalls = 0;
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "true";
    import.meta.env.WXT_SENTRY_RELEASE = "1.0.0";
    import.meta.env.MODE = "test";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete import.meta.env[key];
      else import.meta.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it("omits browser tracing in the background even with a document present", () => {
    initSentry("background");

    // The worker has no document in production. Calling it with one here proves
    // the decision is about the context, not an accidental test-environment quirk.
    expect(mocks.browserTracingCalls).toBe(0);
    expect(integrationNames()).not.toContain("BrowserTracing");
  });

  it("omits browser tracing when the context has no document", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);

    initSentry("popup");

    // A defensive guard: a misfiled worker context must not start web-vitals
    // observers either, even if the context check is bypassed.
    expect(mocks.browserTracingCalls).toBe(0);
    expect(integrationNames()).not.toContain("BrowserTracing");
  });

  it("keeps browser tracing for document contexts", () => {
    initSentry("popup");

    // Removing the DOM-only integration from the worker must not cost the
    // document contexts their page-load traces.
    expect(mocks.browserTracingCalls).toBe(1);
    expect(integrationNames()).toContain("BrowserTracing");
  });
});
