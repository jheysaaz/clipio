/**
 * Tests for src/lib/sentry-scrub.ts
 * spec: specs/sentry-scrub.spec.md
 */

import { describe, it, expect } from "vitest";
import { scrubEvent, scrubBreadcrumb, hostBucket } from "./sentry-scrub";
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
    // A breadcrumb url is the page the user was on, which is the browsing
    // history leak this module exists to prevent. It was previously preserved;
    // "url" is now in SENSITIVE_KEYS. Note the Breadcrumbs integration is
    // excluded from both Sentry clients, so in practice these rarely occur.
    expect(crumb.data!.url).toBe("[REDACTED]");
  });

  it("preserves a non-sensitive breadcrumb field so the crumb stays useful", () => {
    const crumb: Breadcrumb = {
      category: "fetch",
      data: { status_code: 500, method: "GET" },
    };
    scrubBreadcrumb(crumb);
    expect(crumb.data!.status_code).toBe(500);
    expect(crumb.data!.method).toBe("GET");
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

// ---------------------------------------------------------------------------
// hostBucket — coarse site attribution without disclosing the exact site
// spec: specs/sentry-scrub.spec.md
// ---------------------------------------------------------------------------

describe("hostBucket", () => {
  it("reduces a subdomain to its registrable domain", () => {
    expect(hostBucket("mail.google.com")).toBe("google.com");
  });

  it("reduces a deep subdomain to its registrable domain", () => {
    expect(hostBucket("a.b.c.example.co.uk")).toBe("example.co.uk");
  });

  it("returns an already-bare domain unchanged", () => {
    expect(hostBucket("example.com")).toBe("example.com");
  });

  it("keeps a known multi-part public suffix", () => {
    expect(hostBucket("bbc.co.uk")).toBe("bbc.co.uk");
  });

  it("keeps a subdomain under a known multi-part suffix", () => {
    expect(hostBucket("news.bbc.co.uk")).toBe("bbc.co.uk");
  });

  it("handles com.au", () => {
    expect(hostBucket("shop.example.com.au")).toBe("example.com.au");
  });

  it("lowercases the input", () => {
    expect(hostBucket("MAIL.GOOGLE.COM")).toBe("google.com");
  });

  it("trims surrounding whitespace", () => {
    expect(hostBucket("  mail.google.com  ")).toBe("google.com");
  });

  it("discards a trailing dot", () => {
    expect(hostBucket("mail.google.com.")).toBe("google.com");
  });

  // --- negative cases: never echo something that is not a hostname ---

  it("returns empty for an empty string", () => {
    expect(hostBucket("")).toBe("");
  });

  it("returns empty for whitespace only", () => {
    expect(hostBucket("   ")).toBe("");
  });

  it("returns empty for undefined", () => {
    expect(hostBucket(undefined)).toBe("");
  });

  it("returns empty for null", () => {
    expect(hostBucket(null)).toBe("");
  });

  it("returns empty for a full URL (has a scheme and path)", () => {
    expect(hostBucket("https://mail.google.com/inbox?x=1")).toBe("");
  });

  it("returns empty for a bare IPv4 address", () => {
    // Bucketing 192.168.1.1 to 168.1 would be meaningless.
    expect(hostBucket("192.168.1.1")).toBe("");
  });

  it("returns empty for localhost, which has no registrable domain", () => {
    expect(hostBucket("localhost")).toBe("");
  });

  it("returns empty for a string containing a space", () => {
    expect(hostBucket("mail google com")).toBe("");
  });

  it("returns empty for a path traversal attempt", () => {
    expect(hostBucket("../../etc/passwd")).toBe("");
  });

  it("returns empty for a non-string value at runtime", () => {
    expect(hostBucket(42 as unknown as string)).toBe("");
  });

  it("returns empty for an object at runtime", () => {
    expect(hostBucket({} as unknown as string)).toBe("");
  });

  it("never returns a value that is a strict prefix of the input subdomain", () => {
    // The whole point: the subdomain must not survive.
    const bucket = hostBucket("secret-internal.corp.example.com");
    expect(bucket).toBe("example.com");
    expect(bucket).not.toContain("secret-internal");
    expect(bucket).not.toContain("corp");
  });
});

// ---------------------------------------------------------------------------
// Location-field redaction (the backstop for a raw-hostname leak)
// ---------------------------------------------------------------------------

describe("scrubEvent — location fields", () => {
  const cases = [
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
  ] as const;

  for (const key of cases) {
    it(`redacts a raw "${key}" so a leaking call site is still caught`, () => {
      const event = {
        extra: { [key]: "mail.google.com", action: "expandSnippet" },
      } as never;
      const scrubbed = scrubEvent(event) as unknown as {
        extra: Record<string, unknown>;
      };
      expect(scrubbed.extra[key]).toBe("[REDACTED]");
      // The non-sensitive sibling must survive so the event is still useful.
      expect(scrubbed.extra.action).toBe("expandSnippet");
    });
  }

  it("preserves a hostBucket value, which is already coarse", () => {
    const event = {
      extra: { hostBucket: "google.com", elementType: "INPUT" },
    } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      extra: Record<string, unknown>;
    };
    expect(scrubbed.extra.hostBucket).toBe("google.com");
    expect(scrubbed.extra.elementType).toBe("INPUT");
  });
});

// ---------------------------------------------------------------------------
// Free-text fields that key-based redaction structurally cannot reach
// ---------------------------------------------------------------------------

describe("scrubEvent — free-text fields", () => {
  it("truncates a long event.message to 200 chars", () => {
    const event = { message: "x".repeat(5000) } as never;
    const scrubbed = scrubEvent(event) as unknown as { message: string };
    expect(scrubbed.message.length).toBe(200 + " [truncated]".length);
    expect(scrubbed.message.endsWith("[truncated]")).toBe(true);
  });

  it("leaves a short event.message intact", () => {
    const event = { message: "Snippet insertion reverted by host" } as never;
    const scrubbed = scrubEvent(event) as unknown as { message: string };
    expect(scrubbed.message).toBe("Snippet insertion reverted by host");
  });

  it("strips a URL with a query string from event.message", () => {
    const event = {
      message: "failed loading https://app.example.com/inbox?token=secret123",
    } as never;
    const scrubbed = scrubEvent(event) as unknown as { message: string };
    expect(scrubbed.message).not.toContain("secret123");
    expect(scrubbed.message).not.toContain("token=");
    expect(scrubbed.message).toContain("[url]");
  });

  it("strips every URL from a message containing several", () => {
    const event = {
      message: "a https://x.test/?p=1 then b http://y.test/?q=2 end",
    } as never;
    const scrubbed = scrubEvent(event) as unknown as { message: string };
    expect(scrubbed.message).not.toContain("p=1");
    expect(scrubbed.message).not.toContain("q=2");
  });

  it("truncates exception.values[].value", () => {
    const event = {
      exception: { values: [{ type: "Error", value: "y".repeat(1000) }] },
    } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      exception: { values: { value: string }[] };
    };
    expect(scrubbed.exception.values[0].value.length).toBeLessThan(300);
  });

  it("strips a URL from exception.values[].value", () => {
    const event = {
      exception: {
        values: [{ type: "Error", value: "boom at https://a.test/?leak=1" }],
      },
    } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      exception: { values: { value: string }[] };
    };
    expect(scrubbed.exception.values[0].value).not.toContain("leak=1");
  });

  it("bounds exception.values[].stack, but far less aggressively than a message", () => {
    const event = {
      exception: { values: [{ stack: "z".repeat(5000) }] },
    } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      exception: { values: { stack: string }[] };
    };
    // A real Chrome stack is 300-2000+ chars and Sentry's grouping depends on
    // the frames, so this cap must be an order of magnitude looser than the
    // 200-char message cap. It was previously 200, which kept the top two
    // frames and made crashes far harder to triage.
    expect(scrubbed.exception.values[0].stack.length).toBe(
      2000 + " [truncated]".length
    );
  });

  it("leaves a realistic stack length untouched", () => {
    const stack = `Error: boom\n${"  at fn (https://x.test/a.js:1:1)\n".repeat(40)}`;
    expect(stack.length).toBeGreaterThan(200);
    const event = { exception: { values: [{ stack }] } } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      exception: { values: { stack: string }[] };
    };
    // Only the URL is replaced; the frames survive.
    expect(scrubbed.exception.values[0].stack).toContain("[url]");
    expect(scrubbed.exception.values[0].stack).toContain("Error: boom");
  });

  it("redacts a shortcut, which is often a user-authored phrase", () => {
    const event = { extra: { shortcut: "my home address" } } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      extra: Record<string, unknown>;
    };
    expect(scrubbed.extra.shortcut).toBe("[REDACTED]");
  });

  it("strips a protocol-relative URL from a message", () => {
    const event = { message: "failed at //evil.test/p?token=abc" } as never;
    const scrubbed = scrubEvent(event) as unknown as { message: string };
    expect(scrubbed.message).not.toContain("abc");
  });

  it("strips a data: URI from a message", () => {
    const event = {
      message: "leaked data:text/plain;base64,c2VjcmV0MTIz",
    } as never;
    const scrubbed = scrubEvent(event) as unknown as { message: string };
    expect(scrubbed.message).not.toContain("c2VjcmV0MTIz");
    expect(scrubbed.message).toContain("[url]");
  });

  it("leaves a normal exception value intact", () => {
    const event = {
      exception: { values: [{ type: "Error", value: "Invalid state" }] },
    } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      exception: { values: { value: string }[] };
    };
    expect(scrubbed.exception.values[0].value).toBe("Invalid state");
  });

  it("tolerates an event with no message and no exception", () => {
    const event = { extra: { action: "x" } } as never;
    const scrubbed = scrubEvent(event) as unknown as {
      message?: string;
      extra: Record<string, unknown>;
    };
    expect(scrubbed.message).toBeUndefined();
    expect(scrubbed.extra.action).toBe("x");
  });

  it("tolerates a non-array exception.values", () => {
    const event = { exception: { values: "not-an-array" } } as never;
    expect(() => scrubEvent(event)).not.toThrow();
  });

  it("tolerates a non-string message", () => {
    const event = { message: 42 } as never;
    expect(() => scrubEvent(event)).not.toThrow();
  });
});
