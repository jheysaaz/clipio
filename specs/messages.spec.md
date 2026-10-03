# Module: Messages

> Source: `src/lib/messages.ts`
> Coverage target: 90%

## Purpose

Typed message constants and payload interfaces for background ↔ content-script
communication via `browser.runtime.sendMessage` / `onMessage`.

## Scope

**In scope:** Message type constants and the request/response interfaces that
give them a typed shape.
**Out of scope:** Message handling logic in each context, which lives in the
entrypoints.

---

## What this module actually contains

> **Corrected.** This spec previously documented a `MessageMap` type plus
> `sendMessage` / `onMessage` helpers. **None of those exist.** `messages.ts` is a
> declarations-only module: a message-type constant and two interfaces. The
> helpers do exist in the codebase, but as thin calls to `browser.runtime`
> written directly in the entrypoints rather than as functions exported here.
>
> The old spec was the more dangerous kind of drift — it read as a precise API
> contract, so a reader would reasonably go looking for `MessageMap` and find
> nothing. Found by the drift gate in `specs/coverage-honesty.spec.md`.

---

## `MEDIA_GET_DATA_URL`

The literal message type `"media-get-data-url"`, exported `as const` so it
narrows to that exact string.

**Why it exists:** a content script running in the isolated world sees the
**page's** origin IndexedDB, not the extension's, where media blobs actually
live. So every blob read has to round-trip through the background service
worker, which does have extension-origin storage access.

## `MediaGetDataUrlRequest`

The payload a content script sends. Discriminated by `type`, so it narrows
alongside `MEDIA_GET_DATA_URL`:

```ts
{
  type: "media-get-data-url";
  mediaId: string;
}
```

## `MediaGetDataUrlResponse`

The payload the background returns:

```ts
{ dataUrl: string | null; alt?: string | null }
```

`dataUrl` is nullable because a media entry can exist in metadata while its blob
is gone — that is a normal state, not an error. `alt` is optional because older
entries were stored without it.

---

## Error Handling

- This module declares no runtime logic and throws nothing.
- Failure handling (a missing blob, a background that has not yet registered its
  listener) belongs to the callers in `src/entrypoints/`, and is covered by the
  messaging e2e spec.

---

## Dependencies

- None. This module imports nothing; it is pure type and constant declarations.

---

## Change History

| Date       | Change                                                                        | Author |
| ---------- | ----------------------------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                                                  | —      |
| 2026-10-02 | Corrected: removed the never-built `MessageMap`/`sendMessage`/`onMessage` API | —      |
