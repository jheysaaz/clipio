/**
 * Pure diagnostics logic: log normalisation, filtering, summaries, redaction and
 * the support report.
 *
 * Nothing in this file touches browser APIs or React. The options page collects
 * raw values in `useDiagnosticsSnapshot.ts`, hands them to
 * `buildDiagnosticsSnapshot()`, and renders the result. Keeping the decisions
 * here means a report that looks right in the UI is also a report that can be
 * exercised in a unit test without a browser, a clipboard or a real storage
 * quota.
 *
 * Privacy rule: a report is meant to be pasted into a GitHub issue. It may
 * contain event names, counts, ids and timings; it must not contain page URLs,
 * typed text, API keys or tokens. Redaction happens at the last possible moment
 * in `formatDiagnosticsReport()`, so the live log viewer can still show the
 * full entry a user deliberately enabled verbose logging to see.
 */

import type { DebugLogEntry } from "@/storage/items";

export type DiagnosticContext = DebugLogEntry["context"];

export type LogFilter = {
  context: DiagnosticContext | "all";
  /** Case-insensitive substring matched against event, context and detail. */
  query: string;
};

export type LogSummary = {
  total: number;
  content: number;
  background: number;
  storage: number;
  /** Events whose name indicates a failed or blocked path. */
  suspicious: number;
  byEvent: Record<string, number>;
  firstAt: number | null;
  lastAt: number | null;
};

export type TabHealthEntry = {
  tabId: number;
  /** Hostname only. A full URL is a support-report leak. */
  host: string;
  alive: boolean;
};

export type TabHealth = {
  eligible: number;
  active: number;
  missing: number;
  entries: TabHealthEntry[];
  /** Set when `browser.tabs.query` itself failed, rather than a ping. */
  error?: string;
};

export type StorageSnapshot = {
  mode: "sync" | "local";
  quotaExceeded: boolean;
  localReason: "quota" | "manual";
  snippetCount: number;
  cachedSnippetCount: number;
  backupSnippetCount: number;
  corruptKeys: string[];
  syncDataLost: boolean;
  lastSentryErrorAt: string | null;
  /** Whether a user-supplied key is configured — never the key itself. */
  customGiphyKey: boolean;
};

export type DiagnosticsSnapshot = {
  generatedAt: string;
  version: string;
  storage: StorageSnapshot;
  debugMode: boolean;
  log: LogSummary;
  /** Normalised log entries, kept so the report can include recent events. */
  entries: DebugLogEntry[];
  tabs: TabHealth;
  /** Per-source collection failures. A partial report is still useful. */
  errors: Record<string, string>;
};

/** Raw values gathered by the options page, before verification and summary. */
export type DiagnosticsInput = Omit<DiagnosticsSnapshot, "log" | "entries"> & {
  log: unknown;
};

const CONTEXTS: DiagnosticContext[] = ["content", "background", "storage"];

/**
 * Events that describe a path the extension could not complete.
 *
 * This is an intentionally mechanical name match, not a severity field: the
 * log has no severity, and inventing one at each of ~25 call sites would be a
 * larger change than a diagnostics panel warrants. A high count is a prompt to
 * look, not a verdict.
 */
const SUSPICIOUS_EVENT =
  /(error|fail|reject|skip|quota|revert|no-match|missing|corrupt)/i;

/** Keys whose values must never reach an exported report. */
const SENSITIVE_KEYS = new Set(
  [
    "text",
    "page",
    "url",
    "href",
    "content",
    "detail",
    "dataurl",
    "giphyapikey",
    "apikey",
    "key",
    "token",
    "secret",
    "password",
    "email",
  ].map((key) => key.toLowerCase())
);

const REDACTED = "[redacted]";

/**
 * Turn whatever is in `local:debugLog` into entries the viewer can render.
 *
 * Storage restored from a backup — or written by an older build — is not
 * guaranteed to match the current schema. Dropping malformed rows here keeps a
 * bad record from crashing the Diagnostics tab, which would be the worst place
 * for a diagnostic tool to fail.
 */
export function normaliseLogEntries(value: unknown): DebugLogEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw: unknown): DebugLogEntry[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.ts !== "number" || !Number.isFinite(entry.ts)) return [];
    if (typeof entry.event !== "string") return [];
    if (!CONTEXTS.includes(entry.context as DiagnosticContext)) return [];

    const detail =
      typeof entry.detail === "string"
        ? entry.detail
        : entry.detail === undefined
          ? ""
          : JSON.stringify(entry.detail);

    return [
      {
        ts: entry.ts,
        context: entry.context as DiagnosticContext,
        event: entry.event,
        detail,
      },
    ];
  });
}

/** Filter by context and a case-insensitive substring across the whole entry. */
export function filterLogEntries(
  entries: DebugLogEntry[],
  filter: LogFilter
): DebugLogEntry[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.context !== "all" && entry.context !== filter.context) {
      return false;
    }
    if (!query) return true;
    return `${entry.context} ${entry.event} ${entry.detail}`
      .toLowerCase()
      .includes(query);
  });
}

/** Counts shown above the log and embedded in the exported report. */
export function summarizeLog(entries: DebugLogEntry[]): LogSummary {
  const byEvent: Record<string, number> = {};
  let content = 0;
  let background = 0;
  let storage = 0;
  let suspicious = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const entry of entries) {
    if (entry.context === "content") content += 1;
    else if (entry.context === "background") background += 1;
    else storage += 1;

    if (SUSPICIOUS_EVENT.test(entry.event)) suspicious += 1;
    byEvent[entry.event] = (byEvent[entry.event] ?? 0) + 1;
    firstAt = firstAt === null ? entry.ts : Math.min(firstAt, entry.ts);
    lastAt = lastAt === null ? entry.ts : Math.max(lastAt, entry.ts);
  }

  return {
    total: entries.length,
    content,
    background,
    storage,
    suspicious,
    byEvent,
    firstAt,
    lastAt,
  };
}

/**
 * Whether a tab can host a content script we may legitimately ping.
 *
 * The exclusion list mirrors the existing single-tab health check so the two
 * tools cannot disagree about which tabs count.
 */
export function isDiagnosableTab(tab: {
  id?: number;
  url?: string;
}): tab is { id: number; url: string } {
  if (tab.id === undefined || !tab.url) return false;
  return ![
    "chrome://",
    "chrome-extension://",
    "about:",
    "edge://",
    "moz-extension://",
  ].some((prefix) => tab.url?.startsWith(prefix));
}

/** Hostname only, with a fallback for tabs that report no parseable URL. */
export function tabHost(url: string): string {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "unknown";
  }
}

function redactText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>\\}]+/gi, "[url]")
    .replace(
      /\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;}]+/gi,
      `$1=${REDACTED}`
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, REDACTED);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactValue(child),
    ])
  );
}

/**
 * Sanitise one log detail before it goes into a shareable report.
 *
 * Structured JSON is preferred because it keeps counts and event names useful;
 * a raw string (older entries, or a plain-text log call) still gets URL,
 * credential and long-token scrubbing.
 */
export function redactDetail(detail: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(detail)));
  } catch {
    return redactText(detail);
  }
}

/** Build a verified snapshot from values collected in the options page. */
export function buildDiagnosticsSnapshot(
  input: DiagnosticsInput
): DiagnosticsSnapshot {
  const entries = normaliseLogEntries(input.log);
  const { log: _raw, ...rest } = input;
  void _raw;
  return {
    ...rest,
    entries,
    log: summarizeLog(entries),
  };
}

const MAX_REPORT_EVENTS = 100;
const MAX_TOP_EVENTS = 10;

/**
 * Locale-neutral Markdown, by design: support reports are read by maintainers
 * in any locale, and stable headings are easier to grep and compare.
 */
export function formatDiagnosticsReport(snapshot: DiagnosticsSnapshot): string {
  const storage = snapshot.storage;
  const tabs = snapshot.tabs;
  const topEvents = Object.entries(snapshot.log.byEvent)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOP_EVENTS);

  const lines = [
    "# Clipio diagnostics report",
    "",
    `- Generated: ${snapshot.generatedAt}`,
    `- Extension version: ${snapshot.version}`,
    `- Debug logging: ${snapshot.debugMode ? "on" : "off"}`,
    "",
    "## Storage",
    "",
    `- Mode: ${storage.mode}${storage.quotaExceeded ? " (quota fallback)" : ""}`,
    `- Local-mode reason: ${storage.localReason}`,
    `- Snippets: ${storage.snippetCount}`,
    `- Content-script cache: ${storage.cachedSnippetCount}`,
    `- IndexedDB backup snippets: ${storage.backupSnippetCount}`,
    `- Quarantined sync keys: ${storage.corruptKeys.length}`,
    `- Sync data lost flag: ${storage.syncDataLost}`,
    `- Custom Giphy key configured: ${storage.customGiphyKey}`,
    `- Last Sentry error: ${storage.lastSentryErrorAt ?? "never"}`,
    ...storage.corruptKeys.map((key) => `  - ${key}`),
    "",
    "## Debug log",
    "",
    `- Entries: ${snapshot.log.total}`,
    `- By context: content=${snapshot.log.content}, background=${snapshot.log.background}, storage=${snapshot.log.storage}`,
    `- Suspicious events: ${snapshot.log.suspicious}`,
    `- First entry: ${snapshot.log.firstAt === null ? "none" : new Date(snapshot.log.firstAt).toISOString()}`,
    `- Last entry: ${snapshot.log.lastAt === null ? "none" : new Date(snapshot.log.lastAt).toISOString()}`,
    ...(topEvents.length
      ? [
          "",
          "Top events:",
          ...topEvents.map(([event, count]) => `  - ${event}: ${count}`),
        ]
      : []),
    "",
    "## Tab health",
    "",
    `- Eligible tabs: ${tabs.eligible}`,
    `- Active content scripts: ${tabs.active}`,
    `- Missing content scripts: ${tabs.missing}`,
    ...(tabs.error ? [`- Query error: ${tabs.error}`] : []),
    ...tabs.entries.map(
      (entry) =>
        `  - tab ${entry.tabId} (${entry.host}): ${entry.alive ? "active" : "missing"}`
    ),
    "",
    "## Recent events (redacted)",
    "",
    ...snapshot.entries.slice(-MAX_REPORT_EVENTS).map((entry) => {
      const time = new Date(entry.ts).toISOString();
      return `- ${time} [${entry.context}] ${entry.event}: ${redactDetail(entry.detail)}`;
    }),
    "",
    "## Collection warnings",
    "",
    ...(Object.keys(snapshot.errors).length
      ? Object.entries(snapshot.errors).map(
          ([source, message]) => `- ${source}: ${message}`
        )
      : ["- none"]),
    "",
    "## Privacy",
    "",
    "- Page URLs, typed text, API keys, tokens and long opaque values are redacted above.",
    "- Snippet contents and media data URLs are never included.",
    "",
  ];

  return lines.join("\n");
}
