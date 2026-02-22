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
]);

function redactObject(
  obj: Record<string, unknown>
): Record<string, unknown> {
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
 * Redacts sensitive fields in `extra` and `contexts` while leaving
 * error messages, stack traces, and tags intact.
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
          : {} as Record<string, unknown>;
    }
    event.contexts = scrubbed;
  }

  return event;
}

/**
 * Scrub a Sentry breadcrumb before it is attached to an event.
 * Strips sensitive data from fetch/XHR/console breadcrumbs.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data && typeof breadcrumb.data === "object") {
    breadcrumb.data = redactObject(
      breadcrumb.data as Record<string, unknown>
    );
  }

  // Strip long string values from console breadcrumbs that may echo snippet text
  if (breadcrumb.category === "console" && typeof breadcrumb.message === "string") {
    // Keep the prefix (e.g. "[Clipio] ...") but truncate long messages
    if (breadcrumb.message.length > 200) {
      breadcrumb.message = breadcrumb.message.slice(0, 200) + " [truncated]";
    }
  }

  return breadcrumb;
}
