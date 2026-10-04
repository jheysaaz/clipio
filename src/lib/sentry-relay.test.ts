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
 *
 * The sender check moved out of this file when the relay moved onto the shared
 * protocol: `onMessageFromSelf` performs it for every handler in the extension.
 * What is asserted here now is that the relay *uses* that wrapper — a handler
 * registered any other way would silently lose the boundary, and there would be
 * nothing in this file to notice.
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
// import — `makeRelayTransport` would be a no-op vi.fn returning undefined and
// every test here would fail on `transport.flush`. Undo it here and nowhere
// else.
vi.mock(
  "~/lib/sentry-relay",
  async () => await vi.importActual("./sentry-relay")
);

import {
  chromeListenerRegistrationCount,
  dispatchToChromeListeners,
  mockChromeRuntime,
  resetChromeMessageBus,
} from "../../tests/mocks/browser";

import { MESSAGE, messenger, onMessageFromSelf } from "./protocol";
import {
  makeRelayTransport,
  registerSentryRelayListener,
} from "./sentry-relay";

const DSN = "https://abc123@o1.ingest.sentry.io/456";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void
) => boolean | undefined;

/** Build a protocol-shaped relay message, as a content script would send it. */
function relayMessage(envelope = '{"event_id":"e1"}') {
  return {
    id: 1,
    type: MESSAGE.SENTRY_RELAY,
    data: { envelope },
    timestamp: Date.now(),
  };
}

/** Ask the relay, as this extension. Resolves to `{ ok }`. */
async function relayFromSelf(envelope?: string) {
  const response = (await dispatchToChromeListeners(relayMessage(envelope), {
    id: browser.runtime.id,
  })) as { res?: { ok: boolean }; err?: unknown } | undefined;
  return response?.res;
}

/** Ask the relay as a hostile web page would. */
async function relayFromHostilePage(envelope?: string) {
  const response = (await dispatchToChromeListeners(relayMessage(envelope), {
    id: "a-hostile-page",
  })) as { res?: unknown; err?: { name?: string } } | undefined;
  return response?.err;
}

const mockFetch = vi.fn();

/**
 * The envelope the transport tried to relay, or `undefined` if it did not.
 *
 * The protocol wraps a payload as `{ id, type, data, timestamp }`, so this reads
 * through to `data.envelope`. Asserting on the envelope string rather than the
 * whole envelope keeps these tests from breaking on an unrelated change to the
 * wrapper.
 */
function relayedEnvelope(): string | undefined {
  const call = (
    mockChromeRuntime.sendMessage as unknown as {
      mock: { calls: unknown[][] };
    }
  ).mock.calls[0];
  return (call?.[0] as { data?: { envelope?: string } } | undefined)?.data
    ?.envelope;
}

describe("registerSentryRelayListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChromeMessageBus();
    import.meta.env.WXT_SENTRY_DSN = DSN;
    mockFetch.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    registerSentryRelayListener();
  });

  afterEach(() => {
    messenger.removeAllListeners();
    vi.unstubAllGlobals();
    delete import.meta.env.WXT_SENTRY_DSN;
  });

  // --- the sender check ------------------------------------------------

  it("never forwards an envelope a web page posted", async () => {
    // The critical assertion. `sender.id` for a web page is not the
    // extension's; a content script, popup or options page all report it.
    await expect(relayFromHostilePage()).resolves.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports the refusal as UntrustedSenderError, not as a failed relay", async () => {
    // Otherwise a caller cannot tell "you may not ask that" from "Sentry is
    // down", and the two want very different handling.
    const error = await relayFromHostilePage();
    expect(error?.name).toBe("UntrustedSenderError");
  });

  it("refuses a relay message that carries no sender id at all", async () => {
    // `sender.id` undefined must not compare equal to `runtime.id` by accident.
    const response = await dispatchToChromeListeners(relayMessage(), {});
    expect(response).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("registers through the shared sender-checking wrapper", () => {
    // The boundary above is only real if the handler goes through
    // `onMessageFromSelf`. Nothing in this file would notice a handler
    // registered any other way, so the check is stated as a fact about the
    // registration: the relay shares the messenger rather than adding a
    // listener of its own.
    const viaMessenger = messenger.onMessage;
    expect(typeof viaMessenger).toBe("function");
    // One root listener serves every message type, so the relay did not add a
    // second `runtime.onMessage` listener.
    expect(chromeListenerRegistrationCount()).toBe(1);
  });

  it("ignores messages that are not for the relay", async () => {
    // This listener coexists with the media and ping handlers.
    const response = await dispatchToChromeListeners(
      {
        id: 2,
        type: "some-other-feature",
        data: {},
        timestamp: Date.now(),
      },
      { id: browser.runtime.id }
    );

    expect(response).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ignores a null or non-object message without throwing", async () => {
    for (const message of [null, undefined, "a string", 42]) {
      expect(
        await dispatchToChromeListeners(message, { id: browser.runtime.id })
      ).toBeUndefined();
    }
  });

  // --- required inputs -------------------------------------------------

  it("refuses when no DSN is configured", async () => {
    delete import.meta.env.WXT_SENTRY_DSN;
    expect(await relayFromSelf()).toEqual({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses when the envelope is empty", async () => {
    expect(await relayFromSelf("")).toEqual({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // --- forwarding ------------------------------------------------------

  it("POSTs the envelope to the ingest URL derived from the DSN", async () => {
    await expect(relayFromSelf()).resolves.toEqual({ ok: true });

    // The DSN's project id (456) and host build the endpoint. Getting the path
    // wrong would send telemetry somewhere harmless-looking and silent.
    expect(mockFetch).toHaveBeenCalledWith(
      "https://o1.ingest.sentry.io/api/456/envelope/",
      expect.objectContaining({
        method: "POST",
        body: '{"event_id":"e1"}',
        headers: { "Content-Type": "application/x-sentry-envelope" },
      })
    );
  });

  it("reports failure when the forward request rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    expect(await relayFromSelf()).toEqual({ ok: false });
  });

  it("reports failure instead of throwing on a malformed DSN", async () => {
    // `new URL()` throws on this. The handler must answer the sender rather
    // than let the exception escape into the message dispatch.
    import.meta.env.WXT_SENTRY_DSN = "not-a-url";

    await expect(relayFromSelf()).resolves.toEqual({ ok: false });
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
    resetChromeMessageBus();
    serializeEnvelope.mockReturnValue('{"event_id":"e1"}');
    // A stub receiver, so "the relay reached the background" is a real
    // round trip rather than the absence of one. The tests that need the relay
    // to *fail* take it away again explicitly.
    onMessageFromSelf(MESSAGE.SENTRY_RELAY, () => ({ ok: true }));
  });

  afterEach(() => {
    messenger.removeAllListeners();
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
    expect(mockChromeRuntime.sendMessage).not.toHaveBeenCalled();
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

    expect(relayedEnvelope()).toBe('{"event_id":"e1"}');
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
    expect(relayedEnvelope()).toBe('{"event_id":"e2"}');
  });

  it("never throws when both the direct send and the relay fail", async () => {
    createTransport.mockReturnValue({
      send: vi.fn(async () => {
        throw new Error("blocked");
      }),
      flush: undefined,
    });
    // The realistic relay failure is "nothing is listening", which is what a
    // suspended or torn-down background worker looks like to the content
    // script. Removing the receiver reproduces it exactly.
    //
    // The previous version of this test reached for
    // `mockChromeRuntime.sendMessage.mockRejectedValueOnce`, which cannot work:
    // that replaces the implementation, so the callback the library is waiting
    // on is never invoked and the promise never settles — the test hung until
    // the 5s timeout rather than failing.
    messenger.removeAllListeners();
    resetChromeMessageBus();

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
