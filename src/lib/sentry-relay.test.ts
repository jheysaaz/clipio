/**
 * Tests for src/lib/sentry-relay.ts
 *
 * Two halves, and the first is the one that matters:
 *
 *  - registerSentryRelayListener accepts envelopes from the extension and
 *    forwards them to Sentry's ingest endpoint on the background worker's
 *    behalf. Any page on the internet can post a message to an extension's
 *    runtime, so the sender check is the whole security boundary — if it is
 *    wrong, a hostile site can use the user's extension as a relay to any
 *    endpoint the DSN points at, with the user's credentials.
 *
 *  - makeRelayTransport is the content-script side: try a direct fetch, and
 *    when the host page's CSP blocks it, fall back to the relay. Its hard
 *    requirement is that it never throws, because it runs inside the content
 *    script's own error handler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTransport = vi.fn();
const serializeEnvelope = vi.fn();

vi.mock("@sentry/core", () => ({
  createTransport: (...a: unknown[]) => createTransport(...a),
  serializeEnvelope: (...a: unknown[]) => serializeEnvelope(...a),
}));

// tests/setup.ts replaces ~/lib/sentry-relay with a stub so no other test can
// accidentally reach Sentry. That stub is what this file would otherwise
// import — `registerSentryRelayListener` would be a no-op vi.fn and every test
// would pass against nothing. Undo it here and nowhere else.
vi.mock(
  "~/lib/sentry-relay",
  async () => await vi.importActual("./sentry-relay")
);

import {
  makeRelayTransport,
  registerSentryRelayListener,
  SENTRY_RELAY_MESSAGE_TYPE,
} from "./sentry-relay";

const DSN = "https://abc123@o1.ingest.sentry.io/456";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void
) => boolean | undefined;

/** Register the listener and hand back the callback WXT would have received. */
function register(): Listener {
  registerSentryRelayListener();
  const addListener = browser.runtime.onMessage.addListener as unknown as {
    mock: { calls: [Listener][] };
  };
  const call = addListener.mock.calls[0];
  if (!call) throw new Error("no listener was registered");
  return call[0];
}

function relay(envelope = '{"event_id":"e1"}') {
  return { type: SENTRY_RELAY_MESSAGE_TYPE, envelope };
}

const mockFetch = vi.fn();

describe("registerSentryRelayListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    import.meta.env.WXT_SENTRY_DSN = DSN;
    mockFetch.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete import.meta.env.WXT_SENTRY_DSN;
  });

  // --- the sender check ------------------------------------------------

  it("refuses a relay message from a page that is not this extension", () => {
    const sendResponse = vi.fn();
    const listener = register();

    // The critical assertion: sender.id is the extension's own id. A content
    // script, popup or options page all report it; a web page does not.
    const result = listener(
      relay(),
      { id: "some-other-extension" },
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a relay message that carries no sender id at all", () => {
    const sendResponse = vi.fn();
    const listener = register();

    // sender.id undefined must not compare equal to runtime.id by accident.
    listener(relay(), {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ignores messages that are not for the relay", () => {
    const sendResponse = vi.fn();
    const listener = register();

    const result = listener(
      { type: "some-other-feature" },
      { id: browser.runtime.id },
      sendResponse
    );

    // Not consuming the message is the point: this listener coexists with
    // every other onMessage handler in the extension.
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("ignores a null or non-object message without throwing", () => {
    const listener = register();

    for (const message of [null, undefined, "a string", 42]) {
      expect(listener(message, { id: browser.runtime.id }, vi.fn())).toBe(
        false
      );
    }
  });

  // --- required inputs -------------------------------------------------

  it("refuses when no DSN is configured", () => {
    delete import.meta.env.WXT_SENTRY_DSN;
    const sendResponse = vi.fn();
    const listener = register();

    const result = listener(relay(), { id: browser.runtime.id }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses when the envelope is empty", () => {
    const sendResponse = vi.fn();
    const listener = register();

    const result = listener(
      { type: SENTRY_RELAY_MESSAGE_TYPE, envelope: "" },
      { id: browser.runtime.id },
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // --- forwarding ------------------------------------------------------

  it("POSTs the envelope to the ingest URL derived from the DSN", async () => {
    const sendResponse = vi.fn();
    const listener = register();

    const result = listener(relay(), { id: browser.runtime.id }, sendResponse);

    // The DSN's project id (456) and host build the endpoint. Getting the
    // path wrong would send telemetry somewhere harmless-looking and silent.
    expect(mockFetch).toHaveBeenCalledWith(
      "https://o1.ingest.sentry.io/api/456/envelope/",
      expect.objectContaining({
        method: "POST",
        body: '{"event_id":"e1"}',
        headers: { "Content-Type": "application/x-sentry-envelope" },
      })
    );
    // Returning true tells Chrome the response arrives asynchronously.
    expect(result).toBe(true);

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: true })
    );
  });

  it("reports failure when the forward request rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const sendResponse = vi.fn();
    const listener = register();

    listener(relay(), { id: browser.runtime.id }, sendResponse);

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false })
    );
  });

  it("reports failure instead of throwing on a malformed DSN", () => {
    import.meta.env.WXT_SENTRY_DSN = "not-a-url";
    const sendResponse = vi.fn();
    const listener = register();

    // new URL() throws on this. The catch must answer the sender rather than
    // let the exception escape into the message dispatch.
    expect(() =>
      listener(relay(), { id: browser.runtime.id }, sendResponse)
    ).not.toThrow();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("makeRelayTransport", () => {
  /** Capture the request function handed to createTransport. */
  function stubDirect(send: (request: unknown) => Promise<unknown>) {
    createTransport.mockImplementation(
      (_options: unknown, request: (r: unknown) => Promise<unknown>) => ({
        send,
        flush: vi.fn(async () => true),
      })
    );
  }

  const options = {
    url: "https://o1.ingest.sentry.io/api/456/envelope/",
    headers: { "Content-Type": "application/x-sentry-envelope" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    serializeEnvelope.mockReturnValue('{"event_id":"e1"}');
  });

  it("sends directly when the page's CSP allows it", async () => {
    // Records the request function so the transport can be driven.
    let request: ((r: unknown) => Promise<unknown>) | undefined;
    createTransport.mockImplementation(
      (_o: unknown, req: (r: unknown) => Promise<unknown>) => {
        request = req;
        return {
          send: vi.fn(async () => ({ statusCode: 0 })),
          flush: undefined,
        };
      }
    );

    const transport = makeRelayTransport(options as never);
    const result = await transport.send({} as never);

    expect(result).toMatchObject({ statusCode: 0 });
    // No relay message when the direct path worked — an unnecessary hop
    // through the background worker is pure overhead.
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    void request;
  });

  it("relays through the background when the direct send throws", async () => {
    createTransport.mockReturnValue({
      send: vi.fn(async () => {
        throw new Error("Refused to connect");
      }),
      flush: undefined,
    });

    const transport = makeRelayTransport(options as never);
    const result = await transport.send({} as never);

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: SENTRY_RELAY_MESSAGE_TYPE,
      envelope: '{"event_id":"e1"}',
    });
    expect(result).toMatchObject({ statusCode: 200 });
  });

  it("decodes a serialized envelope that came back as bytes", async () => {
    serializeEnvelope.mockReturnValue(
      new TextEncoder().encode('{"event_id":"e2"}')
    );
    createTransport.mockReturnValue({
      send: vi.fn(async () => {
        throw new Error("blocked");
      }),
      flush: undefined,
    });

    const transport = makeRelayTransport(options as never);
    await transport.send({} as never);

    // sendMessage must carry a string. A raw Uint8Array would fail structured
    // cloning's expectations and the envelope would be lost.
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ envelope: '{"event_id":"e2"}' })
    );
  });

  it("never throws when both the direct send and the relay fail", async () => {
    createTransport.mockReturnValue({
      send: vi.fn(async () => {
        throw new Error("blocked");
      }),
      flush: undefined,
    });
    // `Once`, not the persistent form: the shared browser mock is only
    // mockClear'd between tests, so a persistent rejection would leak into
    // every later test that expects sendMessage to succeed.
    (
      browser.runtime.sendMessage as unknown as {
        mockRejectedValueOnce: (e: unknown) => void;
      }
    ).mockRejectedValueOnce(new Error("no receiving end"));

    const transport = makeRelayTransport(options as never);

    // This runs inside the content script's error handler. Throwing here would
    // replace the original error with a confusing one.
    await expect(transport.send({} as never)).resolves.toMatchObject({
      statusCode: 0,
    });
  });

  it("delegates flush to the underlying transport when it has one", async () => {
    const flush = vi.fn(async () => false);
    createTransport.mockReturnValue({
      send: vi.fn(async () => ({ statusCode: 200 })),
      flush,
    });

    const transport = makeRelayTransport(options as never);

    await expect(transport.flush(1234)).resolves.toBe(false);
    expect(flush).toHaveBeenCalledWith(1234);
  });

  it("reports flush as successful when there is nothing to flush", async () => {
    createTransport.mockReturnValue({
      send: vi.fn(async () => ({ statusCode: 200 })),
      flush: undefined,
    });

    const transport = makeRelayTransport(options as never);

    await expect(transport.flush()).resolves.toBe(true);
  });

  void stubDirect;
});
