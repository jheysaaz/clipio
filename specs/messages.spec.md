# Module: Messages

> Source: `src/lib/messages.ts`
> Coverage target: 90%

## Purpose

Type-safe message passing between extension contexts (background, content, popup, options).

## Scope

**In scope:** Message type definitions, send/receive helpers.
**Out of scope:** Message handling logic in each context.

---

## `MessageMap`

Defines all message types with typed payloads.

---

## `sendMessage<M extends keyof MessageMap>(type: M, payload: MessageMap[M]): Promise<unknown>`

Sends a message to the appropriate context.

---

## `onMessage<M extends keyof MessageMap>(type: M, handler: (payload: MessageMap[M]) => Promise<unknown> | unknown): void`

Registers a handler for a message type.

---

## Error Handling

- Handlers catch and log errors.
- Does not throw.

---

## Dependencies

- `browser.runtime` APIs.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |