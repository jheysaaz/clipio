# 0009 — The messaging library does not check who sent a message

Date: 2026-10-04
Status: Accepted

## Context

Any page on the internet can post to an extension's `runtime.onMessage`. There is
no origin restriction on the receiving side: the extension decides, per handler,
whether to believe the payload. Every handler that touched something sensitive
therefore carried its own check — `background.ts` compared `sender.id` against
`runtime.id` before reading a media blob, and `sentry-relay.ts` did the same
before POSTing an envelope to the endpoint its DSN names.

`@webext-core/messaging` changes how handlers are registered but not what they
receive. From its `dist/index.mjs`:

```js
addRootListener(processMessage) {
    const listener = (message, sender, sendResponse) => {
        const res = processMessage(typeof message === "object"
            ? { ...message, sender }   // sender is passed through, untouched
            : message);
```

It spreads `sender` into the message and does nothing with it. That is a genuine
improvement on the raw API — the origin information is now carried for you
instead of being a second parameter you can forget — but it is not enforcement.

## Decision

**`onMessageFromSelf` is the only way to register a handler, and it rejects any
message whose `sender.id` is not this extension's.**

The unwrapped `messenger.onMessage` is deliberately not re-exported from
`src/lib/protocol`. A new message therefore cannot forget the check, because
there is no unwrapped way to register one. `UntrustedSenderError` is a distinct
class so a caller can tell "you may not ask that" from "the request failed" —
which the media reader depends on, since it reports a missing blob as a warning
and everything else to Sentry.

**It throws rather than returning nothing.** Returning `undefined` would type as
a valid response — `undefined` is not a `MediaGetResponse` — so every caller
would need a nullish branch that can never be true while the type claimed the
response was total. A rejection is both honest and impossible to ignore.

## Consequences

- **Errors lose their prototype across a context boundary.** The library
  serialises a thrown error and rebuilds it in the caller's context: `name` and
  `message` survive, the prototype does not. So in a receiving context
  `err instanceof MediaNotFoundError` is **false** even when it plainly is one.
  Every error check goes through `isProtocolError`, which compares `name`, and
  `instanceof` appears in no call site. One of the tests in
  `src/lib/protocol/index.test.ts` pins this, because it is exactly the sort of
  thing that looks like it works.
- **The wire format changed.** Messages are now `{ id, type, data, timestamp }`.
  A content script in an already-open tab may still be running the previous
  build's `{ type, mediaId }`, which no longer matches the shape and is ignored.
  The e2e suite asserts that, because "old build still open" is a real state
  after an update and a silent drop is otherwise indistinguishable from a refusal.
- **A missing receiver now rejects** rather than resolving with `undefined`. The
  options page's health check relied on that distinction to tell "no content
  script in this tab" from "something answered"; it now uses `.catch()`.
- **`media:get` answers a missing blob by throwing `MediaNotFoundError`** instead
  of returning `{ dataUrl: null }`. The old response type made "no such media"
  and "the blob was unreadable" look identical, so a routine missing image after
  a partial import reported to Sentry as an error.

## Alternatives rejected

- **Rely on `throwOnUnknownMessageFormat`.** Unrelated: that guards the envelope
  shape, not the sender. Turning it *on* would also let any page crash the
  background worker by posting a malformed message.
- **Check `sender` inside each handler.** That is what the code did before, and
  it works — but it is a convention, so it holds only until someone adds a
  handler and forgets. The wrapper makes it structural.
- **Validate inside a shared root listener and drop quietly.** Silently dropping
  is what the previous `background.ts` handler did, and it is why the e2e suite
  had to assert on a null field to prove the message had been received at all.