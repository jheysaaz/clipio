/**
 * The Clipio messaging protocol.
 *
 * Every runtime message the extension sends, in one place, with its payload and
 * response types declared. `@webext-core/messaging` reads this map, so a
 * mismatched payload or a missing `onMessage` is a compile error at the call
 * site rather than a runtime `undefined` that fails somewhere else.
 *
 * This replaces `src/lib/messages.ts`, which hand-typed a single message out of
 * four. Nothing was wrong with it; it just could not express "these are all the
 * messages", so the other three stayed as string literals scattered across the
 * background, the content script and an options panel.
 *
 * ── Sender trust ────────────────────────────────────────────────────────────
 *
 * `onMessageFromSelf` is the only way to register a handler in this codebase,
 * and it refuses anything whose `sender.id` is not this extension's. That check
 * is **not** the library's job: `@webext-core/messaging` spreads `sender` into
 * the received message and does nothing with it, so a web page can post a
 * message to any extension that listens on `runtime.onMessage` and the handler
 * would run with the page's payload.
 *
 * Routing every handler through one wrapper makes the check structural. A new
 * message cannot forget it, because there is no unwrapped `onMessage` exported.
 * See docs/decisions/0009-messaging-validate-sender.md.
 */

import { defineExtensionMessaging } from "@webext-core/messaging";
import type {
  ExtensionMessage,
  GetReturnType,
  Logger,
  MaybePromise,
  Message,
  RemoveListenerCallback,
} from "@webext-core/messaging";

// ---------------------------------------------------------------------------
// Wire strings
// ---------------------------------------------------------------------------
//
// Declared as literals rather than inferred, so the type of `Protocol` below
// stays a readable list in review. `as const` on each keeps them from widening.

export const MESSAGE = {
  /**
   * Content script → background: read a media blob as a data URL.
   *
   * Content scripts in the isolated world see the *page's* origin IndexedDB,
   * not the extension's, so every blob read has to cross to the background.
   */
  MEDIA_GET: "media:get",
  /** Options page → content script: is a content script alive in this tab? */
  CONTENT_PING: "content:ping",
  /** Dev-only: options page or a keyboard chord → content script Sentry test. */
  SENTRY_TEST: "dev:sentry-test",
  /** Content script → background: forward a Sentry envelope past a page CSP. */
  SENTRY_RELAY: "sentry:relay",
} as const;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type MediaGetPayload = { mediaId: string };

/**
 * A blob, as a data URL.
 *
 * `alt` is nullable rather than optional because it is always decided: a media
 * entry either has alt text or it does not. The old response type had it
 * optional, which made every reader write a `?? null` for a field that was
 * never actually missing.
 */
export type MediaGetResponse = {
  dataUrl: string;
  alt: string | null;
};

export type SentryRelayPayload = { envelope: string };

export type SentryRelayResponse = { ok: boolean };

export type PingResponse = { pong: true };

/**
 * The protocol map.
 *
 * Function syntax, so the payload type comes from the parameter and the
 * response type from the return. A message with no payload and no response is
 * written as `() => {}`, which infers `undefined` in and `void` out.
 */
export type ClipioProtocol = {
  [MESSAGE.MEDIA_GET]: (data: MediaGetPayload) => MediaGetResponse;
  [MESSAGE.CONTENT_PING]: () => PingResponse;
  [MESSAGE.SENTRY_TEST]: () => void;
  [MESSAGE.SENTRY_RELAY]: (data: SentryRelayPayload) => SentryRelayResponse;
};

export type MessageType = keyof ClipioProtocol;

/** A handler as `onMessageFromSelf` accepts it. */
export type ProtocolHandler<TType extends MessageType> = (
  message: Message<ClipioProtocol, TType> & ExtensionMessage
) => MaybePromise<GetReturnType<ClipioProtocol[TType]>>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a message arrives from something other than this extension.
 *
 * A distinct class so a caller can tell "you may not ask that" from "the
 * request failed". The content script's media reader uses exactly that
 * distinction: a rejection from a foreign sender is not a missing blob, and
 * must not be reported to the user as one.
 */
export class UntrustedSenderError extends Error {
  constructor(receivedId?: string) {
    super(
      `Refused a runtime message from sender ${receivedId ?? "<none>"}: not this extension`
    );
    this.name = "UntrustedSenderError";
  }
}

/** Thrown by the media handler when the requested id is not in the store. */
export class MediaNotFoundError extends Error {
  constructor(mediaId: string) {
    super(`No media entry for id "${mediaId}"`);
    this.name = "MediaNotFoundError";
  }
}

/**
 * Whether a caught error is a specific protocol error.
 *
 * ── Why this exists, and why `instanceof` does not ──────────────────────────
 *
 * An error thrown inside a handler is serialised and rebuilt in the caller's
 * context. The `name` and `message` survive; **the prototype does not**. So in
 * the receiving context:
 *
 *     try { await sendMessage("media:get", { mediaId }); }
 *     catch (e) { e instanceof MediaNotFoundError }   // always false
 *
 * is false even when the error is unambiguously a `MediaNotFoundError`. Pinning
 * that fact is one of the tests in `index.test.ts`, because it is exactly the
 * kind of thing that looks like it works.
 *
 * So every error check in this codebase goes through here and compares `name`.
 * The alternative — comparing messages — would break the moment someone rewords
 * a string.
 *
 * A plain `instanceof Error` is still required, so that a structured clone
 * carrying a lookalike `{ name: "…" }` plain object is not mistaken for one of
 * ours. Nothing beyond that is required: the rebuilt error's `constructor.name`
 * is `"Error"`, so checking that too would reject every genuine cross-context
 * error — which is precisely the case this function exists to handle.
 */
export function isProtocolError<E extends Error>(
  error: unknown,
  ctor: abstract new (...args: never[]) => E
): error is E {
  return error instanceof Error && error.name === ctor.name;
}

// ---------------------------------------------------------------------------
// The messenger
// ---------------------------------------------------------------------------

/**
 * `throwOnUnknownMessageFormat: false` — a message not in this protocol's shape
 * is ignored rather than thrown on. The alternative lets any web page crash the
 * background worker by posting a malformed message.
 */
/**
 * Swallow the library's own logging.
 *
 * It logs every send and receive to the console by default. Media data URLs and
 * Sentry envelopes would land in the page-visible console of every user, and a
 * debug log already exists (`src/lib/debug.ts`) behind a user-facing switch.
 *
 * The `Logger | undefined` type has no `null`, so a no-op object rather than the
 * `null` the upstream docs suggest.
 */
const SILENT_LOGGER: Logger = {
  debug: () => {},
  log: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The raw messenger.
 *
 * Exported only so tests can drive it. **Handlers must be registered through
 * `onMessageFromSelf`**, which performs the sender check — using this directly
 * would register a handler with no boundary, and it would compile and run
 * cleanly. Decision 0009 previously claimed no unwrapped registration path was
 * reachable; that was not true, and this export is why.
 *
 * An earlier version of that claim is corrected in the record rather than
 * quietly dropped, because the guarantee is enforced by convention and a
 * convention that is stated as a mechanism gets believed in.
 */
export const messenger = defineExtensionMessaging<ClipioProtocol>({
  logger: SILENT_LOGGER,
  throwOnUnknownMessageFormat: false,
});

/** Whether a message came from this extension rather than from a web page. */
export function isOwnSender(sender: ExtensionMessage["sender"]): boolean {
  return sender.id === browser.runtime.id;
}

/**
 * Register a handler that only ever runs for messages from this extension.
 *
 * A foreign sender gets an `UntrustedSenderError`, which the library serialises
 * and re-throws on the caller's side.
 *
 * Throwing rather than returning `undefined` is deliberate. Returning nothing
 * would type as a valid response — `undefined` is not a `MediaGetResponse` — so
 * every caller would need a nullish check that can never be true, and the type
 * would be quietly lying. A rejection is both honest and hard to ignore.
 */
export function onMessageFromSelf<TType extends MessageType>(
  type: TType,
  handler: ProtocolHandler<TType>
): RemoveListenerCallback {
  return messenger.onMessage(type, (message) => {
    if (!isOwnSender(message.sender)) {
      throw new UntrustedSenderError(message.sender.id);
    }
    return handler(message);
  });
}

/**
 * Send to the background, or to a tab when a `tabId` or
 * `{ tabId, frameId }` follows the payload.
 *
 * Re-exported from the messenger rather than re-wrapped: `sendMessage` is an
 * overloaded generic whose second parameter is `never` for a message that has a
 * payload, so any hand-written wrapper signature has to choose one overload and
 * breaks the other. Extracting the bound method keeps both intact — it is
 * declared `this: void`, so it is safe to detach.
 */
export const sendMessage = messenger.sendMessage;
