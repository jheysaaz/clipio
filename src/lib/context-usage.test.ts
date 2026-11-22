import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_SITES_PER_SNIPPET,
  MAX_CONTEXT_SNIPPETS,
  compareSnippetContext,
  normalizeContextUsage,
  normalizeHostname,
  recordSnippetUse,
  type ContextUsage,
  type SnippetContextUse,
} from "./context-usage";

function entry(overrides: Partial<SnippetContextUse> = {}): SnippetContextUse {
  return { lastUsedAt: 0, uses: 0, sites: [], ...overrides };
}

describe("normalizeHostname", () => {
  it("returns a lower-cased bare hostname without a trailing dot", () => {
    expect(normalizeHostname("  GitHub.com.  ")).toBe("github.com");
  });

  it("reduces a full URL to the hostname only", () => {
    // The storage contract is a bare hostname. A caller passing a full URL must
    // not be able to smuggle a path, query or fragment into the value.
    const result = normalizeHostname(
      "https://user:pass@Example.COM:8443/owner/repo?tab=readme#install"
    );
    expect(result).toBe("example.com");
    expect(JSON.stringify(result)).not.toContain("owner");
    expect(JSON.stringify(result)).not.toContain("readme");
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["non-string", 42],
    ["not a hostname", "not a host"],
    ["script scheme", "javascript:alert(1)"],
    ["malformed URL", "https://exa mple.com/path"],
    ["empty labels", "example..com"],
  ])("rejects %s", (_label, value) => {
    expect(normalizeHostname(value)).toBeNull();
  });
});

describe("normalizeContextUsage", () => {
  it("returns an empty map for values that are not objects", () => {
    expect(normalizeContextUsage(null)).toEqual({});
    expect(normalizeContextUsage([])).toEqual({});
    expect(normalizeContextUsage("stored")).toEqual({});
  });

  it("drops empty and malformed entries while keeping valid ones", () => {
    const result = normalizeContextUsage({
      empty: entry(),
      garbage: "nope",
      valid: entry({ lastUsedAt: 100, uses: 2 }),
      wrongTimestamp: { lastUsedAt: "yesterday", uses: 0, sites: [] },
    });

    expect(Object.keys(result)).toEqual(["valid"]);
    expect(result.valid).toEqual({ lastUsedAt: 100, uses: 2, sites: [] });
  });

  it("normalises sites and merges duplicates by hostname", () => {
    const result = normalizeContextUsage({
      s1: {
        lastUsedAt: 200,
        uses: 4,
        sites: [
          { hostname: "GitHub.com", lastUsedAt: 200, uses: 2 },
          { hostname: "github.com", lastUsedAt: 150, uses: 3 },
          {
            hostname: "https://evil.example/path?q=1",
            lastUsedAt: 10,
            uses: 1,
          },
          { hostname: "not a host", lastUsedAt: 10, uses: 1 },
          null,
        ],
      },
    });

    expect(result.s1.sites).toEqual([
      { hostname: "github.com", lastUsedAt: 200, uses: 3 },
      { hostname: "evil.example", lastUsedAt: 10, uses: 1 },
    ]);
  });

  it("caps sites per snippet and snippets overall", () => {
    const sites = Array.from(
      { length: MAX_CONTEXT_SITES_PER_SNIPPET + 5 },
      (_, i) => ({
        hostname: `site${i}.example`,
        lastUsedAt: i + 1,
        uses: 1,
      })
    );
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < MAX_CONTEXT_SNIPPETS + 5; i += 1) {
      raw[`s${i}`] = entry({ lastUsedAt: i + 1, sites });
    }

    const result = normalizeContextUsage(raw);

    expect(Object.keys(result)).toHaveLength(MAX_CONTEXT_SNIPPETS);
    expect(result.s5?.sites).toHaveLength(MAX_CONTEXT_SITES_PER_SNIPPET);
    // The oldest entries are the ones dropped, not whichever came last in the
    // object literal.
    expect(result[`s${MAX_CONTEXT_SNIPPETS + 4}`]).toBeDefined();
    expect(result.s0).toBeUndefined();
  });
});

describe("recordSnippetUse", () => {
  it("records a bare hostname and increments both global and site uses", () => {
    const first = recordSnippetUse(
      {},
      "s1",
      "https://Example.com/path?q=1",
      1000
    );

    expect(first.s1).toEqual({
      lastUsedAt: 1000,
      uses: 1,
      sites: [{ hostname: "example.com", lastUsedAt: 1000, uses: 1 }],
    });
    expect(JSON.stringify(first)).not.toContain("/path");
    expect(JSON.stringify(first)).not.toContain("q=1");
  });

  it("reuses the site entry on a second insertion instead of duplicating it", () => {
    const first = recordSnippetUse({}, "s1", "example.com", 1000);
    const second = recordSnippetUse(first, "s1", "example.com", 2000);

    expect(second.s1.uses).toBe(2);
    expect(second.s1.sites).toHaveLength(1);
    expect(second.s1.sites[0]).toEqual({
      hostname: "example.com",
      lastUsedAt: 2000,
      uses: 2,
    });
    expect(first.s1.uses).toBe(1); // copy-on-write, not mutation
  });

  it("keeps other snippets and hostnames when recording a use", () => {
    const existing: ContextUsage = {
      s2: entry({ lastUsedAt: 50, uses: 1 }),
    };
    const first = recordSnippetUse(existing, "s1", "one.example", 100);
    const second = recordSnippetUse(first, "s1", "two.example", 200);

    expect(second.s2).toEqual(existing.s2);
    expect(second.s1.sites.map((site) => site.hostname)).toEqual([
      "two.example",
      "one.example",
    ]);
  });

  it("returns the same map for an invalid hostname or snippet id", () => {
    const usage: ContextUsage = { s1: entry({ lastUsedAt: 1, uses: 1 }) };

    expect(recordSnippetUse(usage, "s1", "not a host", 10)).toBe(usage);
    expect(recordSnippetUse(usage, "   ", "example.com", 10)).toBe(usage);
  });

  it("uses the current time when no timestamp is supplied", () => {
    // Covers the default parameter, which is what production callers use.
    const before = Date.now();
    const result = recordSnippetUse({}, "s1", "example.com");
    const after = Date.now();

    expect(result.s1.lastUsedAt).toBeGreaterThanOrEqual(before);
    expect(result.s1.lastUsedAt).toBeLessThanOrEqual(after);
  });

  it("caps the number of remembered hostnames per snippet", () => {
    let usage: ContextUsage = {};
    for (let i = 0; i < MAX_CONTEXT_SITES_PER_SNIPPET + 4; i += 1) {
      usage = recordSnippetUse(usage, "s1", `site${i}.example`, i + 1);
    }

    expect(usage.s1.sites).toHaveLength(MAX_CONTEXT_SITES_PER_SNIPPET);
    expect(usage.s1.sites[0]?.hostname).toBe(
      `site${MAX_CONTEXT_SITES_PER_SNIPPET + 3}.example`
    );
  });
});

describe("compareSnippetContext", () => {
  const host = "github.com";

  it("prefers more insertions on the current hostname over overall recency", () => {
    const a = entry({
      lastUsedAt: 9000,
      uses: 20,
      sites: [{ hostname: host, lastUsedAt: 9000, uses: 1 }],
    });
    const b = entry({
      lastUsedAt: 1000,
      uses: 1,
      sites: [{ hostname: host, lastUsedAt: 1000, uses: 5 }],
    });

    expect(compareSnippetContext(a, b, host)).toBeGreaterThan(0);
  });

  it("uses site recency when same-site insertion counts are equal", () => {
    const a = entry({
      lastUsedAt: 100,
      sites: [{ hostname: host, lastUsedAt: 200, uses: 2 }],
    });
    const b = entry({
      lastUsedAt: 900,
      sites: [{ hostname: host, lastUsedAt: 800, uses: 2 }],
    });

    expect(compareSnippetContext(a, b, host)).toBeGreaterThan(0);
  });

  it("falls back to overall recency when neither snippet was used on the site", () => {
    const a = entry({
      lastUsedAt: 900,
      sites: [{ hostname: "other.example", lastUsedAt: 900, uses: 9 }],
    });
    const b = entry({ lastUsedAt: 100, uses: 1 });

    expect(compareSnippetContext(a, b, host)).toBeLessThan(0);
  });

  it("uses total insertions as the final tie-break", () => {
    expect(
      compareSnippetContext(entry({ uses: 3 }), entry({ uses: 7 }), host)
    ).toBeGreaterThan(0);
  });

  it("ignores site signals when there is no hostname", () => {
    const a = entry({
      sites: [{ hostname: host, lastUsedAt: 1000, uses: 10 }],
    });
    const b = entry({ lastUsedAt: 500, uses: 1 });

    // Without a current site, only b's overall recency can speak — and a's zero
    // recency loses to it.
    expect(compareSnippetContext(a, b, null)).toBeGreaterThan(0);
  });

  it("returns zero for equal context", () => {
    const a = entry({ lastUsedAt: 100, uses: 2 });
    expect(compareSnippetContext(a, a, host)).toBe(0);
    expect(compareSnippetContext(undefined, undefined, host)).toBe(0);
  });
});
