/**
 * "Before init" behaviour of src/lib/sentry-content.ts
 *
 * Separate file, deliberately. `extensionScope` is module state that
 * initSentry() sets and nothing ever clears, so "what happens before the first
 * init" is only observable in a module that has not been initialised. Putting
 * these assertions in the main suite made them depend on test ORDER — they
 * passed only because they ran before the init tests, which is exactly the
 * kind of test that breaks on a reformat.
 */

import { describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({ init: vi.fn() }));
const mockScope = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  setExtras: vi.fn(),
}));
const item = vi.hoisted(() => ({
  getValue: vi.fn(async () => null),
  setValue: vi.fn(async () => {}),
}));

vi.mock("~/lib/sentry-content", () => import("./sentry-content"));
vi.mock("@sentry/core", async () => {
  const actual =
    await vi.importActual<typeof import("@sentry/core")>("@sentry/core");
  return {
    ...actual,
    Client: class {
      init = mockClient.init;
      constructor(public _options: unknown) {}
    },
    Scope: class {
      setTag = vi.fn();
      setClient = vi.fn();
      setExtras = vi.fn();
      captureException = vi.fn();
      captureMessage = vi.fn();
    },
  };
});
vi.mock("@sentry/browser", () => ({
  chromeStackLineParser: () => ({}),
  geckoStackLineParser: () => ({}),
}));
vi.mock("./sentry-relay", () => ({ makeRelayTransport: vi.fn(() => ({})) }));
vi.mock("./sentry-scrub", () => ({
  scrubEvent: vi.fn((e: unknown) => e),
  scrubBreadcrumb: vi.fn((b: unknown) => b),
}));
vi.mock("~/storage/items", () => ({ lastSentryErrorAtItem: item }));

import.meta.env.WXT_SENTRY_DSN =
  "https://examplePublicKey@o0.ingest.sentry.io/0";
import.meta.env.WXT_SENTRY_ENABLED = "true";

const { captureError, captureMessage, initSentry } =
  await import("./sentry-content");

describe("sentry-content before initSentry", () => {
  it("has not initialised a client", () => {
    expect(mockClient.init).not.toHaveBeenCalled();
  });

  it("captureError still records the error time", () => {
    expect(() => captureError(new Error("boom"))).not.toThrow();
    expect(item.setValue).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it("captureError does not throw when the scope is absent", () => {
    // The early return is the point: an error thrown before init must not
    // become a second error.
    expect(() =>
      captureError(new Error("boom"), { action: "save" })
    ).not.toThrow();
  });

  it("captureMessage is a silent no-op", () => {
    expect(() => captureMessage("hello")).not.toThrow();
    expect(mockScope.captureMessage).not.toHaveBeenCalled();
  });

  it("initSentry is what changes this", () => {
    initSentry();
    expect(mockClient.init).toHaveBeenCalled();
  });
});
