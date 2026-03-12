/**
 * Tests for src/lib/sentry-scrub.ts
 * spec: specs/sentry-scrub.spec.md
 */

import { describe, it, expect } from "vitest";
import { scrubEvent, scrubBreadcrumb } from "./sentry-scrub";
import type { Event } from "@sentry/browser";
import type { Breadcrumb } from "@sentry/core";

// ---------------------------------------------------------------------------
// scrubEvent
// ---------------------------------------------------------------------------

describe("scrubEvent", () => {
  // spec: MUST scrub event.extra by running redactObject on it
  it("redacts sensitive keys in event.extra", () => {
    const event: Event = {
      extra: { content: "my snippet body", snippetId: "abc123" },
    };
    scrubEvent(event);
    expect(event.extra!.content).toBe("[REDACTED]");
    expect(event.extra!.snippetId).toBe("abc123"); // non-sensitive — preserved
  });

  it("redacts all known sensitive keys", () => {
    const sensitiveKeys = [
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
    ];
    const extra: Record<string, string> = {};
    for (const k of sensitiveKeys) extra[k] = "sensitive-value";

    const event: Event = { extra };
    scrubEvent(event);

    for (const k of sensitiveKeys) {
      expect(event.extra![k]).toBe("[REDACTED]");
    }
  });

  // spec: MUST recurse into nested plain objects
  it("redacts nested sensitive keys", () => {
    const event: Event = {
      extra: { nested: { text: "sensitive", id: "safe" } } as Record<
        string,
        unknown
      >,
    };
    scrubEvent(event);
    const nested = event.extra!.nested as Record<string, unknown>;
    expect(nested.text).toBe("[REDACTED]");
    expect(nested.id).toBe("safe");
  });

  // spec: MUST NOT recurse into arrays (arrays are redacted at the key level)
  it("redacts array values at key level without recursing", () => {
    const event: Event = {
      extra: { items: ["a", "b"] } as Record<string, unknown>,
    };
    scrubEvent(event);
    expect(event.extra!.items).toBe("[REDACTED]"); // items is a sensitive key
  });

  // spec: MUST handle event.extra === undefined gracefully
  it("handles missing event.extra gracefully", () => {
    const event: Event = {};
    expect(() => scrubEvent(event)).not.toThrow();
  });

  // spec: MUST scrub event.contexts
  it("redacts sensitive keys in event.contexts", () => {
    const event: Event = {
      contexts: {
        clipboardData: { value: "clipboard content", source: "user" },
      },
    };
    scrubEvent(event);
    const ctx = event.contexts!.clipboardData as Record<string, unknown>;
    expect(ctx.value).toBe("[REDACTED]");
    expect(ctx.source).toBe("user"); // non-sensitive — preserved
  });

  // spec: MUST handle event.contexts === undefined gracefully
  it("handles missing event.contexts gracefully", () => {
    const event: Event = {};
    expect(() => scrubEvent(event)).not.toThrow();
  });

  // spec: MUST return the same event object (mutated in-place)
  it("returns the same event object", () => {
    const event: Event = { extra: { content: "sensitive" } };
    const returned = scrubEvent(event);
    expect(returned).toBe(event);
  });

  // spec: non-sensitive keys in extra are NOT modified
  it("preserves non-sensitive keys in extra", () => {
    const event: Event = {
      extra: { action: "loadSnippets", snippetId: "abc", count: 5 } as Record<
        string,
        unknown
      >,
    };
    scrubEvent(event);
    expect(event.extra!.action).toBe("loadSnippets");
    expect(event.extra!.snippetId).toBe("abc");
    expect(event.extra!.count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// scrubBreadcrumb
// ---------------------------------------------------------------------------

describe("scrubBreadcrumb", () => {
  // spec: MUST scrub breadcrumb.data
  it("redacts sensitive keys in breadcrumb.data", () => {
    const crumb: Breadcrumb = {
      category: "fetch",
      data: { content: "snippet body", url: "https://example.com" },
    };
    scrubBreadcrumb(crumb);
    expect(crumb.data!.content).toBe("[REDACTED]");
    expect(crumb.data!.url).toBe("https://example.com");
  });

  // spec: MUST handle missing breadcrumb.data gracefully
  it("handles missing breadcrumb.data gracefully", () => {
    const crumb: Breadcrumb = { category: "fetch" };
    expect(() => scrubBreadcrumb(crumb)).not.toThrow();
  });

  // spec: MUST truncate console breadcrumb messages > 200 chars
  it("truncates console breadcrumb messages longer than 200 chars", () => {
    const longMessage = "a".repeat(201);
    const crumb: Breadcrumb = {
      category: "console",
      message: longMessage,
    };
    scrubBreadcrumb(crumb);
    expect(crumb.message!.length).toBeLessThanOrEqual(
      200 + " [truncated]".length
    );
    expect(crumb.message).toContain("[truncated]");
  });

  it("truncated message starts with first 200 chars", () => {
    const longMessage = "a".repeat(201);
    const crumb: Breadcrumb = {
      category: "console",
      message: longMessage,
    };
    scrubBreadcrumb(crumb);
    expect(crumb.message!.startsWith("a".repeat(200))).toBe(true);
  });

  // spec: MUST NOT truncate messages ≤ 200 chars
  it("does not truncate console messages of exactly 200 chars", () => {
    const message = "b".repeat(200);
    const crumb: Breadcrumb = {
      category: "console",
      message,
    };
    scrubBreadcrumb(crumb);
    expect(crumb.message).toBe(message);
  });

  it("does not truncate short console messages", () => {
    const crumb: Breadcrumb = {
      category: "console",
      message: "Short message",
    };
    scrubBreadcrumb(crumb);
    expect(crumb.message).toBe("Short message");
  });

  // spec: MUST NOT truncate messages for non-console breadcrumbs
  it("does not truncate long messages for non-console categories", () => {
    const longMessage = "a".repeat(201);
    const crumb: Breadcrumb = {
      category: "fetch",
      message: longMessage,
    };
    scrubBreadcrumb(crumb);
    expect(crumb.message).toBe(longMessage); // not truncated
  });

  // spec: MUST return the same breadcrumb object
  it("returns the same breadcrumb object", () => {
    const crumb: Breadcrumb = { category: "console", data: { text: "hi" } };
    const returned = scrubBreadcrumb(crumb);
    expect(returned).toBe(crumb);
  });
});
