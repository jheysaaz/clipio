# Spec: Sentry Scrubbing

> Source: `src/lib/sentry-scrub.ts`
> Tests: `src/lib/sentry-scrub.test.ts`
> Coverage target: 90%

## Purpose

Removes user-identifying and user-authored data from Sentry events before they leave the
machine, while preserving enough structure to actually debug with.

## Scope

**In scope:** Event and breadcrumb scrubbing, host bucketing, message/exception sanitising.
**Out of scope:** Sentry initialisation, transport, integration selection.

---

## Threat model

Clipio runs on `<all_urls>` and has `clipboardRead`. Its content script therefore has
ambient access to whatever page the user is on. Anything it reports to a third party is a
potential disclosure of browsing behaviour or authored text.

Verified as **not** currently leaking, and therefore not changed here:

- No call site interpolates page or snippet text into an error message.
- Clipboard content is never passed as an extra; `"clipboard"` and `"clipboardText"` are
  already in `SENSITIVE_KEYS`.
- The content-script client installs only `inboundFilters`, `linkedErrors` and `dedupe` —
  no `globalHandlers`, no `tryCatch`, no `breadcrumbs` — so a hostile page cannot get its
  own errors captured.
- `sendDefaultPii` is never set.
- Page titles and URL query strings are never read.

---

## `hostBucket(hostname)`

Reduces a hostname to its registrable domain so a diagnostic event still answers "is this
Gmail-specific?" without disclosing the exact site.

`mail.google.com` → `google.com`. Subdomain and any path/query are dropped.

This is an approximation of eTLD+1: the public suffix list is a ~250 KB data file and is
not shipped. A short list of common multi-part public suffixes (`co.uk`, `com.au`, …) is
hard-coded; an unlisted multi-part suffix degrades to the last two labels, which is
coarser than ideal but never more revealing.

An empty, non-hostname, or IP-shaped input returns `""` rather than being echoed back.

---

## `scrubEvent(event)`

- Redacts keys in `SENSITIVE_KEYS` in `event.extra` and `event.contexts`, recursively for
  nested plain objects. Array values are redacted at the key level and not descended into.
- `SENSITIVE_KEYS` includes the location fields `host`, `hostname`, `url`, `pathname`,
  `query` and `referrer`. These are a backstop: call sites should send a `hostBucket`
  value rather than a raw hostname, so the diagnostic survives, but if a future call site
  leaks a raw location the scrubber still catches it.
- Truncates `event.message` to 200 characters and strips URL-shaped substrings from it.
- Applies the same treatment to `exception.values[].value` and `exception.values[].stack`.

**Why the message pass exists.** `redactObject` matches on _key names_, so it is
structurally incapable of protecting a bare string field. A `SENSITIVE_KEYS` entry cannot
help, because the payload is not keyed. Today no call site leaks here, but the hole is one
`throw new Error(\`bad snippet ${snippet.content}\`)` away, so the guard is added now rather
than after a report.

Message truncation is deliberately _not_ redaction: the message is the single most useful
field for debugging, so it is bounded and URL-stripped rather than removed.

---

## `scrubBreadcrumb(breadcrumb)`

- Redacts `SENSITIVE_KEYS` in `breadcrumb.data`.
- Truncates `console` breadcrumb messages longer than 200 characters, keeping the
  `[Clipio]` prefix so the event type is still identifiable.

---

## Non-Goals

- Filtering Sentry's `cultureContext` integration, which attaches the user's locale and
  timezone to every event. That is a separate decision about what the store listing
  discloses, not a scrubbing bug.
- Redacting `tag: "extension.id"`. It is the extension's own public identity.

---

## Change History

| Date       | Change                                                                                                                                                                                                          | Author |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                                                                                                                                                                                    | —      |
| 2026-09-26 | Corrected the documented export name (`scrubSentryEvent` did not exist; the functions are `scrubEvent` and `scrubBreadcrumb`). Added `hostBucket` and the message/exception pass, and an explicit threat model. | —      |
