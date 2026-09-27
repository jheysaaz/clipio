/**
 * PII scrubbing helpers for Sentry events and breadcrumbs.
 *
 * Strategy (moderate scrubbing):
 *   - Preserve: error messages, error types, stack traces, shortcut keys,
 *     snippet IDs, tags, and all structural metadata.
 *   - Redact: snippet content bodies, clipboard data, raw user text, and
 *     any field whose key suggests it holds user-generated content.
 */

import type { Event } from "@sentry/browser";
import type { Breadcrumb } from "@sentry/core";

/** Keys whose values should be replaced with "[REDACTED]" */
const SENSITIVE_KEYS = new Set([
  "content",
  "snippet",
  "snippetContent",
  "clipboard",
  "clipboardText",
  "body",
  "text",
  "html",
  "rawContent",
  "value",
  "newValue",
  "oldValue",
  "cachedSnippets",
  "items",
  // A shortcut is frequently a user-authored phrase ("my address", "/sig"),
  // and it is one of the few snippet fields sent as an extra.
  "shortcut",
  // Location fields. Call sites should send a hostBucket() value rather than a
  // raw hostname so the diagnostic survives, but redactObject matches on key
  // name and is the only backstop if a future call site leaks one.
  "host",
  "hostname",
  "url",
  "href",
  "pathname",
  "path",
  "search",
  "query",
  "referrer",
  "documentUrl",
  "location",
]);

/** Longest error message we are willing to send. */
const MAX_MESSAGE_LENGTH = 200;

/**
 * Longest stack trace we are willing to send.
 *
 * Deliberately far larger than the message cap. A real Chrome stack runs
 * 300-2000+ characters, and Sentry's grouping depends on the frames; capping a
 * stack at 200 chars keeps the top two frames and makes crashes far harder to
 * triage. Stacks are code paths, not user data, and the URL-stripping below is
 * the part that actually matters for them.
 */
const MAX_STACK_LENGTH = 2000;

/**
 * Common multi-part public suffixes, so "bbc.co.uk" buckets to "bbc.co.uk"
 * rather than "co.uk". Not exhaustive — this is an approximation of the public
 * suffix list, which is a ~250 KB data file and is not shipped. An unlisted
 * multi-part suffix degrades to the last two labels, which is coarser than
 * ideal but never more revealing than sending the hostname itself.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "or.jp",
  "ne.jp",
  "co.nz",
  "com.br",
  "com.mx",
  "co.in",
  "co.za",
  "com.sg",
  "com.hk",
  "com.cn",
  "co.kr",
]);

/**
 * Reduce a hostname to its registrable domain for reporting.
 *
 * The content script sends `window.location.hostname` with every
 * insertion-failure event, which is a partial browsing-history stream to a
 * third party. Full redaction would destroy the diagnostic value — "is this
 * Gmail-specific?" is the question these events exist to answer — so the
 * hostname is bucketed to its registrable domain instead.
 *
 * Returns "" for input that is not a plausible hostname, rather than echoing
 * an arbitrary string back to Sentry.
 *
 * @example
 * hostBucket("mail.google.com")   // "google.com"
 * hostBucket("bbc.co.uk")         // "bbc.co.uk"
 * hostBucket("")                  // ""
 */
export function hostBucket(hostname: string | undefined | null): string {
  if (typeof hostname !== "string") return "";
  const value = hostname.trim().toLowerCase();
  if (!value) return "";
  // Reject anything with scheme, path, port, whitespace or userinfo. A hostname
  // is labels separated by dots only.
  if (!/^[a-z0-9.-]+$/.test(value)) return "";
  // Reject bare IPs: bucketing 192.168.1.1 to 168.1 would be meaningless and
  // an IPv4 literal is already not very identifying, so report nothing.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return "";
  // "localhost" has no registrable domain.
  if (value === "localhost") return "";

  const labels = value.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");

  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Matches URL-shaped substrings in free text, so their query strings can be
 * stripped. Covers absolute http(s) URLs, protocol-relative "//host/path",
 * and data: URIs — a protocol-relative or data: form in a message is just as
 * capable of carrying user data as an absolute one.
 */
const URL_LIKE = /(?:https?:)?\/\/[^\s"'<>)\]]+|data:[^\s"'<>)\]]+/gi;

/**
 * Bound a free-text field that cannot be redacted by key name.
 *
 * Truncates to MAX_MESSAGE_LENGTH and replaces URL-shaped substrings, whose
 * query strings are the most likely accidental carrier of user data.
 */
function sanitizeMessage(value: unknown, maxLength: number): unknown {
  if (typeof value !== "string") return value;
  let out = value.replace(URL_LIKE, "[url]");
  if (out.length > maxLength) {
    out = out.slice(0, maxLength) + " [truncated]";
  }
  return out;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = redactObject(val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Scrub a Sentry event before it is sent.
 *
 * Redacts sensitive keyed fields in `extra` and `contexts`, and bounds the
 * free-text fields (`message`, exception values and stacks) that key-based
 * redaction structurally cannot reach.
 */
export function scrubEvent(event: Event): Event {
  if (event.extra && typeof event.extra === "object") {
    event.extra = redactObject(event.extra as Record<string, unknown>);
  }

  if (event.contexts && typeof event.contexts === "object") {
    const scrubbed: Record<string, Record<string, unknown>> = {};
    for (const [ctxKey, ctxVal] of Object.entries(event.contexts)) {
      scrubbed[ctxKey] =
        ctxVal !== null && ctxVal !== undefined && typeof ctxVal === "object"
          ? redactObject(ctxVal as Record<string, unknown>)
          : ({} as Record<string, unknown>);
    }
    event.contexts = scrubbed;
  }

  // Free-text fields: bounded and URL-stripped, not removed, because the
  // message is the single most useful field for debugging.
  event.message = sanitizeMessage(event.message, MAX_MESSAGE_LENGTH) as string;

  const exceptionValues = (event.exception as { values?: unknown })?.values;
  if (Array.isArray(exceptionValues)) {
    for (const entry of exceptionValues) {
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        if ("value" in record) {
          record.value = sanitizeMessage(record.value, MAX_MESSAGE_LENGTH);
        }
        if ("stack" in record) {
          record.stack = sanitizeMessage(record.stack, MAX_STACK_LENGTH);
        }
      }
    }
  }

  return event;
}

/**
 * Scrub a Sentry breadcrumb before it is attached to an event.
 * Strips sensitive data from fetch/XHR/console breadcrumbs.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data && typeof breadcrumb.data === "object") {
    breadcrumb.data = redactObject(breadcrumb.data as Record<string, unknown>);
  }

  // Strip long string values from console breadcrumbs that may echo snippet text
  if (
    breadcrumb.category === "console" &&
    typeof breadcrumb.message === "string"
  ) {
    // Keep the prefix (e.g. "[Clipio] ...") but truncate long messages
    if (breadcrumb.message.length > 200) {
      breadcrumb.message = breadcrumb.message.slice(0, 200) + " [truncated]";
    }
  }

  return breadcrumb;
}
