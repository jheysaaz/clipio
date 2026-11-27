/**
 * Tests for src/lib/diagnostics.ts.
 *
 * A support report is a one-way door: once pasted into an issue, a leaked page
 * URL or API key cannot be taken back. These tests assert both that useful data
 * survives the pipeline and that the sensitive fields do not.
 */

import { describe, expect, it } from "vitest";
import type { DebugLogEntry } from "@/storage/items";
import {
  buildDiagnosticsSnapshot,
  filterLogEntries,
  formatDiagnosticsReport,
  isDiagnosableTab,
  normaliseLogEntries,
  redactDetail,
  summarizeLog,
  tabHost,
  type DiagnosticsSnapshot,
} from "./diagnostics";

const entry = (overrides: Partial<DebugLogEntry> = {}): DebugLogEntry => ({
  ts: Date.parse("2026-01-02T03:04:05.000Z"),
  context: "content",
  event: "expand:match",
  detail: '{"shortcut":"/sig"}',
  ...overrides,
});

function snapshot(
  overrides: Partial<DiagnosticsSnapshot> = {}
): DiagnosticsSnapshot {
  return {
    generatedAt: "2026-01-02T03:04:05.000Z",
    version: "1.2.3",
    storage: {
      mode: "sync",
      quotaExceeded: false,
      localReason: "quota",
      snippetCount: 4,
      cachedSnippetCount: 3,
      backupSnippetCount: 2,
      corruptKeys: ["corrupt:snip:1"],
      syncDataLost: false,
      lastSentryErrorAt: null,
      customGiphyKey: false,
    },
    debugMode: true,
    log: summarizeLog([entry()]),
    entries: [entry()],
    tabs: {
      eligible: 2,
      active: 1,
      missing: 1,
      entries: [
        { tabId: 7, host: "example.com", alive: true },
        { tabId: 9, host: "intranet.test", alive: false },
      ],
    },
    errors: {},
    ...overrides,
  };
}

describe("normaliseLogEntries", () => {
  it("treats a non-array stored value as an empty log", () => {
    expect(normaliseLogEntries({ unexpected: true })).toEqual([]);
    expect(normaliseLogEntries(null)).toEqual([]);
  });

  it("drops malformed rows and stringifies object details", () => {
    const body = JSON.stringify({
      ts: Date.parse("2026-01-02T03:04:06.000Z"),
      context: "storage",
      event: "persist:write",
      detail: { count: 2 },
    });
    expect(
      normaliseLogEntries([
        null,
        "not an entry",
        { ts: "yesterday", context: "content", event: "x", detail: "" },
        { ts: 1, context: "content", event: 9, detail: "" },
        { ts: 1, context: "alien", event: "x", detail: "" },
        JSON.parse(body),
        { ts: 2, context: "background", event: "no-detail" },
      ])
    ).toEqual([
      {
        ts: Date.parse("2026-01-02T03:04:06.000Z"),
        context: "storage",
        event: "persist:write",
        detail: '{"count":2}',
      },
      { ts: 2, context: "background", event: "no-detail", detail: "" },
    ]);
  });
});

describe("filterLogEntries", () => {
  const entries = [
    entry({ context: "content", event: "expand:match", detail: '{"a":1}' }),
    entry({
      context: "background",
      event: "media:get",
      detail: "missing blob",
    }),
    entry({
      context: "storage",
      event: "persist:write",
      detail: '{"count":2}',
    }),
  ];

  it("keeps every entry for an all-context filter with no query", () => {
    expect(filterLogEntries(entries, { context: "all", query: "  " })).toEqual(
      entries
    );
  });

  it("filters by context without losing the other contexts", () => {
    expect(
      filterLogEntries(entries, { context: "storage", query: "" })
    ).toEqual([entries[2]]);
  });

  it("matches event, context and detail case-insensitively", () => {
    expect(
      filterLogEntries(entries, { context: "all", query: "MEDIA" })
    ).toEqual([entries[1]]);
    expect(
      filterLogEntries(entries, { context: "all", query: "MISSING BLOB" })
    ).toEqual([entries[1]]);
    expect(
      filterLogEntries(entries, { context: "all", query: "background" })
    ).toEqual([entries[1]]);
  });

  it("treats a query no entry matches as an empty result", () => {
    expect(
      filterLogEntries(entries, { context: "content", query: "media:get" })
    ).toEqual([]);
  });
});

describe("summarizeLog", () => {
  it("returns empty counts for an empty log", () => {
    expect(summarizeLog([])).toEqual({
      total: 0,
      content: 0,
      background: 0,
      storage: 0,
      suspicious: 0,
      byEvent: {},
      firstAt: null,
      lastAt: null,
    });
  });

  it("counts contexts, repeated events, suspicious paths and the time range", () => {
    const entries = [
      entry({ ts: 30, context: "content", event: "expand:done" }),
      entry({ ts: 10, context: "background", event: "expand:no-match" }),
      entry({ ts: 20, context: "storage", event: "expand:done" }),
      entry({ ts: 40, context: "content", event: "expand:done" }),
    ];

    expect(summarizeLog(entries)).toEqual({
      total: 4,
      content: 2,
      background: 1,
      storage: 1,
      suspicious: 1,
      byEvent: { "expand:done": 3, "expand:no-match": 1 },
      firstAt: 10,
      lastAt: 40,
    });
  });
});

describe("isDiagnosableTab", () => {
  it("accepts ordinary pages", () => {
    expect(isDiagnosableTab({ id: 3, url: "https://example.com/a" })).toBe(
      true
    );
  });

  it("rejects internal pages and tabs without an id", () => {
    for (const url of [
      "chrome://extensions/",
      "chrome-extension://abc/options.html",
      "about:blank",
      "edge://settings",
      "moz-extension://abc/options.html",
    ]) {
      expect(isDiagnosableTab({ id: 1, url })).toBe(false);
    }
    expect(isDiagnosableTab({ url: "https://example.com" })).toBe(false);
    expect(isDiagnosableTab({ id: 2 })).toBe(false);
  });
});

describe("tabHost", () => {
  it("returns only the host of a real URL", () => {
    expect(tabHost("https://example.com/a?secret=1")).toBe("example.com");
  });

  it("falls back for a value that is not a URL", () => {
    expect(tabHost("not a url")).toBe("unknown");
  });
});

describe("redactDetail", () => {
  it("redacts sensitive keys while preserving counts and event structure", () => {
    const detail = JSON.stringify({
      page: "https://example.com/private/path?token=1",
      text: "my typed message",
      giphyApiKey: "SUPERSECRETKEY12345678901234567890",
      count: 7,
      nested: { url: "https://intranet.test/x", stuck: true },
    });

    const result = redactDetail(detail);
    expect(result).not.toContain("example.com");
    expect(result).not.toContain("my typed message");
    expect(result).not.toContain("SUPERSECRETKEY");
    expect(result).toContain('"count":7');
    expect(result).toContain('"stuck":true');
    expect(JSON.parse(result)).toMatchObject({
      page: "[redacted]",
      text: "[redacted]",
      giphyApiKey: "[redacted]",
      nested: { url: "[redacted]", stuck: true },
    });
  });

  it("scrubs URLs, credentials and long tokens from plain text", () => {
    const result = redactDetail(
      "typed /sig on https://example.com/inbox apiKey=abcdef1234567890abcdef1234567890"
    );
    expect(result).not.toContain("example.com");
    expect(result).not.toContain("abcdef1234567890abcdef1234567890");
    expect(result).toContain("[url]");
    expect(result).toContain("[redacted]");
  });

  it("passes through short harmless text unchanged", () => {
    expect(redactDetail("plain detail")).toBe("plain detail");
  });
});

describe("buildDiagnosticsSnapshot", () => {
  it("normalises the log and summarises it without retaining raw malformed data", () => {
    const log = [entry(), { nonsense: true }];
    const result = buildDiagnosticsSnapshot({
      generatedAt: "now",
      version: "1.0.0",
      storage: snapshot().storage,
      debugMode: true,
      log,
      tabs: snapshot().tabs,
      errors: { tabs: "denied" },
    });

    expect(result.entries).toEqual([entry()]);
    expect(result.log.total).toBe(1);
    expect(result.errors).toEqual({ tabs: "denied" });
    expect("log" in result).toBe(true);
  });
});

describe("formatDiagnosticsReport", () => {
  it("includes every section and useful counts", () => {
    const report = formatDiagnosticsReport(snapshot());

    expect(report).toContain("# Clipio diagnostics report");
    expect(report).toContain("- Extension version: 1.2.3");
    expect(report).toContain("- Mode: sync");
    expect(report).toContain("- Snippets: 4");
    expect(report).toContain("- Quarantined sync keys: 1");
    expect(report).toContain("  - corrupt:snip:1");
    expect(report).toContain("- Entries: 1");
    expect(report).toContain(
      "- By context: content=1, background=0, storage=0"
    );
    expect(report).toContain("Top events:");
    expect(report).toContain("  - expand:match: 1");
    expect(report).toContain("- Eligible tabs: 2");
    expect(report).toContain("  - tab 9 (intranet.test): missing");
    expect(report).toContain("## Recent events (redacted)");
    expect(report).toContain("## Privacy");
    expect(report).toContain("- none");
  });

  it("redacts secrets, typed text and page URLs from log details", () => {
    const secret = "abcdef1234567890abcdef1234567890";
    const report = formatDiagnosticsReport(
      snapshot({
        entries: [
          entry({
            detail: JSON.stringify({
              page: "https://example.com/inbox",
              text: "sensitive typed text",
              apiKey: secret,
            }),
          }),
        ],
      })
    );

    expect(report).not.toContain(secret);
    expect(report).not.toContain("sensitive typed text");
    expect(report).not.toContain("example.com/inbox");
    expect(report).toContain("[redacted]");
  });

  it("handles an empty snapshot, quota fallback, query errors and warnings", () => {
    const report = formatDiagnosticsReport(
      snapshot({
        debugMode: false,
        storage: {
          mode: "local",
          quotaExceeded: true,
          localReason: "manual",
          snippetCount: 0,
          cachedSnippetCount: 0,
          backupSnippetCount: 0,
          corruptKeys: [],
          syncDataLost: true,
          lastSentryErrorAt: "2026-01-01T00:00:00.000Z",
          customGiphyKey: true,
        },
        log: summarizeLog([]),
        entries: [],
        tabs: {
          eligible: 0,
          active: 0,
          missing: 0,
          entries: [],
          error: "denied",
        },
        errors: { snippets: "storage unavailable" },
      })
    );

    expect(report).toContain("- Mode: local (quota fallback)");
    expect(report).toContain("- Last Sentry error: 2026-01-01T00:00:00.000Z");
    expect(report).toContain("- Custom Giphy key configured: true");
    expect(report).toContain("- First entry: none");
    expect(report).toContain("- Last entry: none");
    expect(report).not.toContain("Top events:");
    expect(report).toContain("- Query error: denied");
    expect(report).toContain("- snippets: storage unavailable");
    expect(report).not.toContain("- none");
  });

  it("caps the recent-event section at the newest 100 entries", () => {
    const entries = Array.from({ length: 105 }, (_, i) =>
      entry({ ts: i + 1, event: `event:${i}`, detail: "" })
    );
    const report = formatDiagnosticsReport(
      snapshot({ entries, log: summarizeLog(entries) })
    );

    expect(report).not.toContain("event:4:");
    expect(report).toContain("event:5:");
    expect(report).toContain("event:104:");
    expect(report.match(/^- \d{4}-\d{2}-\d{2}T/gm)).toHaveLength(100);
  });
});
