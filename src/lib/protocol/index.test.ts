/**
 * Tests for the messaging protocol.
 *
 * These are round-trip tests: a real handler is registered through the real
 * `onMessageFromSelf`, and a real `sendMessage` delivers to it over the `chrome`
 * mock's listener dispatch.
 *
 * That is a deliberate change from what was here before. `src/lib/messages.test.ts`
 * documented why it could only assert `MEDIA_GET_DATA_URL === "media-get-data-url"`:
 * with no bus in the test harness there was no way to send a message and observe
 * a response, so a protocol that had drifted between its sender and its receiver
 * would have passed. Now that the mock dispatches, sender/receiver agreement is
 * directly testable — and it is, below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chromeListenerRegistrationCount,
  dispatchToChromeListeners,
  resetChromeMessageBus,
} from "../../../tests/mocks/browser";

import {
  MESSAGE,
  MediaNotFoundError,
  UntrustedSenderError,
  isOwnSender,
  isProtocolError,
  messenger,
  onMessageFromSelf,
  sendMessage,
} from "./index";

/** A sender that is not this extension — what a hostile page looks like. */
const HOSTILE = { id: "a-hostile-page" };

/**
 * Post a message the way a hostile page would: raw `chrome.runtime.sendMessage`
 * with our type name and a payload of its choosing.
 *
 * Returns the internal `{ res }` / `{ err }` envelope unwrapped to the `err`
 * value, because that is what a rejected caller sees.
 */
async function sendFromHostilePage(
  type: string,
  data?: unknown
): Promise<unknown> {
  const response = (await dispatchToChromeListeners(
    { id: 1, type, data, timestamp: Date.now() },
    HOSTILE
  )) as
    { err?: { name?: string; message?: string }; res?: unknown } | undefined;

  return response?.err;
}

// ---------------------------------------------------------------------------
// Wire strings
// ---------------------------------------------------------------------------

describe("MESSAGE wire strings", () => {
  it("pins every message name", () => {
    // These travel between separately-bundled contexts. A content script in an
    // already-open tab can still be running the previous build's names, so
    // renaming one breaks communication with nothing type-checked.
    expect(MESSAGE.MEDIA_GET).toBe("media:get");
    expect(MESSAGE.CONTENT_PING).toBe("content:ping");
    expect(MESSAGE.SENTRY_TEST).toBe("dev:sentry-test");
    expect(MESSAGE.SENTRY_RELAY).toBe("sentry:relay");
  });

  it("keeps the wire strings distinct from each other", () => {
    const names = Object.values(MESSAGE);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Sender trust
// ---------------------------------------------------------------------------

describe("isOwnSender", () => {
  it("accepts this extension's id", () => {
    expect(isOwnSender({ id: browser.runtime.id })).toBe(true);
  });

  it("rejects another extension's id", () => {
    expect(isOwnSender({ id: "some-other-extension" })).toBe(false);
  });

  it("rejects a missing id rather than comparing undefined loosely", () => {
    // The case a hostile page actually produces: `sender.id` absent. If this
    // returned true, every extension with a listener would be open.
    expect(isOwnSender({})).toBe(false);
  });
});

describe("onMessageFromSelf — sender enforcement", () => {
  beforeEach(() => {
    resetChromeMessageBus();
  });

  afterEach(() => {
    messenger.removeAllListeners();
  });

  it("runs the handler for a message from this extension", async () => {
    onMessageFromSelf(MESSAGE.CONTENT_PING, () => ({ pong: true }));
    await expect(sendMessage(MESSAGE.CONTENT_PING)).resolves.toEqual({
      pong: true,
    });
  });

  it("never runs a handler for a message from a web page", async () => {
    const handler = vi.fn(() => ({ pong: true }) as const);
    onMessageFromSelf(MESSAGE.CONTENT_PING, handler);

    const error = await sendFromHostilePage(MESSAGE.CONTENT_PING);

    expect(handler).not.toHaveBeenCalled();
    expect(error).toBeDefined();
  });

  it("reports the refusal as an UntrustedSenderError", async () => {
    onMessageFromSelf(MESSAGE.CONTENT_PING, () => ({ pong: true }));

    const error = (await sendFromHostilePage(MESSAGE.CONTENT_PING)) as
      { name?: string; message?: string } | undefined;

    // The name and message survive the crossing; the prototype does not. See
    // the `instanceof` test below and `isProtocolError` in the module.
    expect(error?.name).toBe("UntrustedSenderError");
    expect(error?.message).toContain("not this extension");
  });

  it("does not run a media handler for a foreign sender", async () => {
    // The media handler is the one that must never run on a page's say-so: it
    // reads blobs out of the extension's IndexedDB and returns them.
    const handler = vi.fn(() => ({
      dataUrl: "data:image/png;base64,AAAA",
      alt: null,
    }));
    onMessageFromSelf(MESSAGE.MEDIA_GET, handler);

    await sendFromHostilePage(MESSAGE.MEDIA_GET, { mediaId: "m1" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not run the relay handler for a foreign sender", async () => {
    // The relay POSTs to whatever endpoint the extension's DSN names, using the
    // extension's credentials. A page able to reach it could exfiltrate through
    // the user's browser.
    const handler = vi.fn(() => ({ ok: true }));
    onMessageFromSelf(MESSAGE.SENTRY_RELAY, handler);

    await sendFromHostilePage(MESSAGE.SENTRY_RELAY, { envelope: "{}" });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

describe("protocol round trips", () => {
  beforeEach(() => {
    resetChromeMessageBus();
  });

  afterEach(() => {
    messenger.removeAllListeners();
  });

  it("carries a payload to the handler and its response back", async () => {
    // The shape every real message depends on, and the one
    // `src/lib/messages.test.ts` could not express.
    onMessageFromSelf(MESSAGE.MEDIA_GET, ({ data }) => ({
      dataUrl: `data:image/png;base64,${btoa(data.mediaId)}`,
      alt: "a description",
    }));

    await expect(
      sendMessage(MESSAGE.MEDIA_GET, { mediaId: "abc" })
    ).resolves.toEqual({
      dataUrl: `data:image/png;base64,${btoa("abc")}`,
      alt: "a description",
    });
  });

  it("carries a null alt through without the caller substituting a default", async () => {
    // `alt` is nullable rather than optional, so a handler that genuinely has
    // no alt text sends `null` — not an absent key the reader has to default.
    onMessageFromSelf(MESSAGE.MEDIA_GET, () => ({
      dataUrl: "data:image/png;base64,AAAA",
      alt: null,
    }));

    const response = await sendMessage(MESSAGE.MEDIA_GET, { mediaId: "x" });
    expect(response.alt).toBeNull();
    expect("alt" in response).toBe(true);
  });

  it("propagates a handler's failure to the caller", async () => {
    // The behaviour the old protocol could not express: a handler that cannot
    // satisfy the request now rejects, instead of returning a sentinel null the
    // caller has to remember to check.
    onMessageFromSelf(MESSAGE.MEDIA_GET, ({ data }) => {
      throw new MediaNotFoundError(data.mediaId);
    });

    await expect(
      sendMessage(MESSAGE.MEDIA_GET, { mediaId: "gone" })
    ).rejects.toThrow("No media entry for id");
  });

  it("loses the error prototype across the boundary but keeps its name", async () => {
    // A real constraint of the wire, pinned because it is easy to get wrong.
    // `@webext-core/messaging` serialises the error and rebuilds it in the
    // caller's context, so `instanceof MediaNotFoundError` is FALSE there even
    // though the error is unambiguously that one. Anything that needs to branch
    // on an error type must compare `error.name` — which is why `isProtocolError`
    // exists and why `instanceof` appears in no call site in this codebase.
    onMessageFromSelf(MESSAGE.MEDIA_GET, ({ data }) => {
      throw new MediaNotFoundError(data.mediaId);
    });

    const error = await sendMessage(MESSAGE.MEDIA_GET, {
      mediaId: "gone",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MediaNotFoundError);
    expect((error as Error).name).toBe("MediaNotFoundError");
  });

  it("waits for an async handler before responding", async () => {
    onMessageFromSelf(MESSAGE.SENTRY_RELAY, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true };
    });

    await expect(
      sendMessage(MESSAGE.SENTRY_RELAY, { envelope: "{}" })
    ).resolves.toEqual({ ok: true });
  });

  it("delivers to the right handler when several are registered", async () => {
    onMessageFromSelf(MESSAGE.CONTENT_PING, () => ({ pong: true }));
    onMessageFromSelf(MESSAGE.MEDIA_GET, () => ({
      dataUrl: "data:image/png;base64,BBBB",
      alt: null,
    }));

    await expect(sendMessage(MESSAGE.CONTENT_PING)).resolves.toEqual({
      pong: true,
    });
    await expect(
      sendMessage(MESSAGE.MEDIA_GET, { mediaId: "x" })
    ).resolves.toEqual({ dataUrl: "data:image/png;base64,BBBB", alt: null });
  });

  it("leaves an unhandled message unanswered rather than hanging", async () => {
    // No listener for this type. The caller must get a definite failure, not a
    // promise that never settles — which is exactly what the options page sees
    // when it pings a tab with no content script injected.
    onMessageFromSelf(MESSAGE.CONTENT_PING, () => ({ pong: true }));

    await expect(
      sendMessage(MESSAGE.MEDIA_GET, { mediaId: "x" })
    ).rejects.toThrow();
  });

  it("ignores a message that is not in the protocol shape", async () => {
    const handler = vi.fn(() => ({ pong: true }) as const);
    onMessageFromSelf(MESSAGE.CONTENT_PING, handler);

    // A hostile page, or a stale tab still running the previous build, can post
    // anything. No handler may run and nothing may be answered.
    const response = await dispatchToChromeListeners(
      { type: MESSAGE.CONTENT_PING },
      HOSTILE
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });

  it("does not answer a plain object that happens to name a protocol type", async () => {
    // The old `{ type, mediaId }` shape. An already-open tab running the
    // previous build sends this, and it must not be treated as a valid
    // `media:get` — which is why the wire format changed to carry `data`.
    const handler = vi.fn(() => ({ dataUrl: "x", alt: null }));
    onMessageFromSelf(MESSAGE.MEDIA_GET, handler);

    const response = await dispatchToChromeListeners(
      { type: MESSAGE.MEDIA_GET, mediaId: "legacy" },
      { id: browser.runtime.id }
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error discrimination
// ---------------------------------------------------------------------------

describe("isProtocolError", () => {
  it("matches an error thrown in the same context", () => {
    // Same-context `instanceof` would also work here; this only pins that the
    // guard agrees with it rather than being stricter or looser by accident.
    const error = new MediaNotFoundError("m1");
    expect(isProtocolError(error, MediaNotFoundError)).toBe(true);
  });

  it("matches an error rebuilt from the wire, which instanceof cannot", () => {
    // Constructed exactly as the library reconstructs one: a real Error with
    // the right name, no shared prototype.
    const overTheWire = Object.assign(new Error('No media entry for id "m1"'), {
      name: "MediaNotFoundError",
    });
    expect(overTheWire instanceof MediaNotFoundError).toBe(false);
    expect(isProtocolError(overTheWire, MediaNotFoundError)).toBe(true);
  });

  it("rejects a different protocol error", () => {
    const other = Object.assign(new Error("nope"), {
      name: "UntrustedSenderError",
    });
    expect(isProtocolError(other, MediaNotFoundError)).toBe(false);
  });

  it("rejects a same-named error that is not an Error at all", () => {
    // A structured clone could carry anything. Comparing `.name` on a
    // non-Error must not be enough to claim it is one of ours.
    expect(
      isProtocolError({ name: "MediaNotFoundError" }, MediaNotFoundError)
    ).toBe(false);
    expect(isProtocolError(null, MediaNotFoundError)).toBe(false);
    expect(isProtocolError("MediaNotFoundError", MediaNotFoundError)).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("onMessageFromSelf — listener registration", () => {
  beforeEach(() => {
    resetChromeMessageBus();
  });

  afterEach(() => {
    messenger.removeAllListeners();
  });

  it("registers exactly one root listener however many handlers are added", async () => {
    // The library multiplexes every message type through a single
    // `runtime.onMessage` listener. That is what lets the media handler, the
    // relay and the ping coexist without any of them consuming another's
    // messages.
    onMessageFromSelf(MESSAGE.CONTENT_PING, () => ({ pong: true }));
    onMessageFromSelf(MESSAGE.MEDIA_GET, () => ({
      dataUrl: "data:image/png;base64,AAAA",
      alt: null,
    }));

    expect(chromeListenerRegistrationCount()).toBe(1);
    await expect(sendMessage(MESSAGE.CONTENT_PING)).resolves.toBeDefined();
  });

  it("stops answering a message type once its handler is removed", async () => {
    const off = onMessageFromSelf(MESSAGE.CONTENT_PING, () => ({ pong: true }));
    await expect(sendMessage(MESSAGE.CONTENT_PING)).resolves.toEqual({
      pong: true,
    });

    off();

    await expect(sendMessage(MESSAGE.CONTENT_PING)).rejects.toThrow();
  });
});
