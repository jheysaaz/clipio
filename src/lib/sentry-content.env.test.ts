/**
 * Environment-gated behaviour of src/lib/sentry-content.ts
 *
 * Separate file, deliberately. These tests mutate `import.meta.env` and call
 * `initSentry()` repeatedly, and each one asserts on whether a client was built.
 * In the main suite the DSN is set before import and every init succeeds, so
 * these branches — the ones where Sentry correctly stays *off* — are
 * unreachable there. That is the dangerous direction: a regression that
 * initialised Sentry in production while unconfigured would never be caught by
 * a suite that only ever exercises the enabled path.
 *
 * `initSentry()` reads import.meta.env at CALL time, not at module load, which
 * is what makes this fileable at all. The previous env is restored after each
 * test so ordering cannot leak.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBuilt = vi.hoisted(() => ({
  client: null as unknown,
  options: null as Record<string, unknown> | null,
}));

vi.mock("~/lib/sentry-content", () => import("./sentry-content"));

vi.mock("@sentry/core", async () => {
  const actual =
    await vi.importActual<typeof import("@sentry/core")>("@sentry/core");
  return {
    ...actual,
    Client: class {
      init = vi.fn();
      constructor(public _options: unknown) {
        mockBuilt.client = this;
        mockBuilt.options = _options as Record<string, unknown>;
      }
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
vi.mock("~/storage/items", () => ({
  lastSentryErrorAtItem: {
    getValue: vi.fn(async () => null),
    setValue: vi.fn(async () => {}),
  },
}));

const { initSentry } = await import("./sentry-content");

const DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

/** The env keys initSentry() reads, so they can be saved and restored exactly. */
const ENV_KEYS = [
  "WXT_SENTRY_DSN",
  "WXT_SENTRY_ENABLED",
  "WXT_SENTRY_RELEASE",
  "MODE",
] as const;

describe("sentry-content environment gating", () => {
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, import.meta.env[k]]));
    mockBuilt.client = null;
    mockBuilt.options = null;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete import.meta.env[k];
      else import.meta.env[k] = v;
    }
  });

  // --- the DSN gate -------------------------------------------------------

  it("builds no client at all when no DSN is configured", () => {
    delete import.meta.env.WXT_SENTRY_DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "true";

    initSentry();

    // Not "does not throw" — no client may be constructed. A build with no
    // SENTRY_AUTH_TOKEN has no DSN, and a client without one would either throw
    // inside the SDK or buffer events it can never deliver.
    expect(mockBuilt.client).toBeNull();
  });

  it("builds a client once a DSN is present", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "true";

    initSentry();

    expect(mockBuilt.client).not.toBeNull();
    expect(mockBuilt.options?.dsn).toBe(DSN);
  });

  // --- the enabled gate ---------------------------------------------------

  it("stays off outside production when the flag is not set explicitly", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.MODE = "test";
    delete import.meta.env.WXT_SENTRY_ENABLED;

    initSentry();

    // The default is opt-in outside production: a developer build with a DSN
    // baked in must not ship the developer's errors to Sentry.
    expect(mockBuilt.client).toBeNull();
  });

  it("stays off when the flag is explicitly false", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "false";

    initSentry();

    expect(mockBuilt.client).toBeNull();
  });

  it("comes on when the flag is explicitly true, outside production", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.MODE = "test";
    import.meta.env.WXT_SENTRY_ENABLED = "true";

    initSentry();

    expect(mockBuilt.client).not.toBeNull();
  });

  it("defaults to on in production without an explicit flag", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.MODE = "production";
    delete import.meta.env.WXT_SENTRY_ENABLED;

    initSentry();

    expect(mockBuilt.client).not.toBeNull();
    expect(mockBuilt.options?.environment).toBe("production");
  });

  it("reports development as the environment outside production", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.MODE = "test";
    import.meta.env.WXT_SENTRY_ENABLED = "true";

    initSentry();

    expect(mockBuilt.options?.environment).toBe("development");
  });

  // --- the release tag ----------------------------------------------------

  it("prefers an explicit release over the manifest", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "true";
    import.meta.env.WXT_SENTRY_RELEASE = "1.6.0";

    initSentry();

    // WXT_SENTRY_RELEASE lets CI tag a build that is not the released version;
    // the manifest would say something else and mis-group the events.
    expect(mockBuilt.options?.release).toBe("1.6.0");
  });

  it("falls back to the manifest version when no release is given", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "true";
    delete import.meta.env.WXT_SENTRY_RELEASE;

    initSentry();

    // Asserted against the manifest rather than a literal, so this fails if the
    // fallback stops reading the manifest — including the case where it starts
    // throwing, since the source wraps this in a try/catch specifically because
    // `browser` can be absent.
    expect(mockBuilt.options?.release).toBe(
      browser.runtime.getManifest().version
    );
  });

  it("still builds the client when the manifest cannot be read", () => {
    import.meta.env.WXT_SENTRY_DSN = DSN;
    import.meta.env.WXT_SENTRY_ENABLED = "true";
    delete import.meta.env.WXT_SENTRY_RELEASE;

    // The catch branch. Without this, a thrown getManifest() would abort init
    // and the module would silently never report anything — the exact failure
    // the try/catch exists to prevent, and one no other test here can reach.
    const spy = vi
      .spyOn(browser.runtime, "getManifest")
      .mockImplementation(() => {
        throw new Error("no extension context");
      });

    try {
      initSentry();

      expect(mockBuilt.client).not.toBeNull();
      expect(mockBuilt.options?.release).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
