# 0008 — Bucket hostnames to their registrable domain; never send them raw

**Status:** accepted · **Date:** 2026-10-03

## Context

The content script reports insertion failures to Sentry with
`window.location.hostname`. Taken together, that is a partial browsing-history
stream sent to a third party — one hostname per failed expansion, from every
site the user expands snippets on.

The events exist to answer a real diagnostic question: *is this failure specific
to Gmail, or general?* That question cannot be answered if the hostname is
removed, and the failure is worth fixing.

This is a **non-functional invariant**, which is the category most at risk from
[0007](0007-tests-are-the-specification.md): no test name says "do not send
browsing hostnames anywhere", so a refactor can quietly widen what is sent and
the suite stays green.

## Decision

**Never transmit a raw hostname. Reduce it to its registrable domain first.**

`hostBucket()` in `src/lib/sentry-scrub.ts`:

- `mail.google.com` → `google.com`
- `bbc.co.uk` → `bbc.co.uk` (multi-part public suffix handled)
- anything not a plausible hostname → `""`, rather than echoing the input

`scrubEvent` and `scrubBreadcrumb` additionally redact by **key name** —
`hostname`, `url`, and friends are `[url]` regardless of their value, so an
unexpected payload shape is still caught.

## Alternatives considered

**Drop the hostname entirely.** Strongest privacy, and it destroys the only thing
that made these events worth sending. "Which sites break?" becomes unanswerable.

**Send it, with Sentry's data scrubbing configured server-side.** Pushes the
guarantee to a dashboard setting that no test can see and any teammate can
change. A client-side invariant is testable; a dashboard toggle is a promise.

**Ship the full public suffix list (~250 KB).** Accurate, and it is a large data
file in an extension bundle to refine a label that is already approximate. An
unlisted multi-part suffix degrades to the last two labels, which is coarser but
never more revealing than sending the hostname itself.

## Consequences

"Is this Gmail-specific?" is answerable. "Is this *this user's* mail host
breaking?" is not — by design, and that is the trade.

The invariant is enforced by `sentry-scrub.test.ts`, which covers key-based
redaction and the bucketing cases. Adding a new field that carries browsing data
means adding it to the key list, and the suite is what makes that visible.

## Revisit when

Sentry is replaced, or the content script starts reporting a new
page-identifying field. Both are the moment this stops being enforced by
accident.