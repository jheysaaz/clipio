# 0001 — Reject untrusted events in the content script

**Status:** accepted · **Date:** 2026-09-27

## Context

A Chrome isolated world shares the DOM event graph with the page. Page JavaScript
cannot construct a *trusted* event, but it can dispatch a synthetic one — and that
event still arrives at our listeners.

Our `input` and `keydown` listeners are registered on `document` in the **capture**
phase, so they see every event before anything can stop it. At the time, nothing
inspected `Event.isTrusted`.

## Decision

Ignore any `input` / `keydown` event where `isTrusted === false`.

```ts
if (!event.isTrusted) return;
```

## Alternatives considered

**Trust `event.target` / check `isTrusted` later in the handler.** No — capture
phase means we are the first to see it, and by the time a bubbling handler runs a
malicious page has already had its turn.

**Attach to specific elements rather than `document`.** Fragile: content is
editable in `input`, `textarea`, and `contenteditable` in varying shapes, and a new
editable surface would silently skip the guard.

## Consequences

The content script ignores synthetic events. That is a deliberate reduction in
"magic" — it also means anything dispatching synthetic events for legitimate
reasons (some page frameworks do) will not expand snippets.

## Revisit when

A real page reports that snippet expansion stopped working and the input is
confirmed trustworthy. Check `isTrusted` before relaxing this.