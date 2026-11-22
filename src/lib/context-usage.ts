/**
 * Local context signals used to break ties in popup ranking.
 *
 * ── The privacy boundary ────────────────────────────────────────────────────
 *
 * The only site data persisted here is a **bare hostname**: `github.com`, never
 * `https://github.com/owner/repo?tab=readme#install`. A full URL is both a
 * browsing-history record and a path to a page's content; neither has any place
 * in a ranking signal. `normalizeHostname` is deliberately the only way a site
 * value enters this module, and it throws away everything but the hostname.
 *
 * The data stays in `browser.storage.local`. It is never sent to a server, put
 * in Sentry extras, or copied into a backup — a hostname is still browsing
 * context, and the user did not ask us to export it.
 *
 * ── Why these are tie-breaks ────────────────────────────────────────────────
 *
 * Text relevance answers "did this snippet match what I typed". Recency and
 * site use answer "which of several equally good matches do I probably want".
 * They are useful in that order and misleading in any other: a snippet used
 * yesterday on this site must not leapfrog an exact shortcut match because of
 * where it was used. `compareSnippetContext` therefore only runs after the
 * caller has established equal primary relevance.
 */

export const MAX_CONTEXT_SITES_PER_SNIPPET = 12;
export const MAX_CONTEXT_SNIPPETS = 500;

export type SnippetSiteUse = {
  /** Bare hostname, lower-cased. Never a URL, path, query or fragment. */
  hostname: string;
  /** Unix ms of the most recent insertion on this hostname. */
  lastUsedAt: number;
  /** Number of insertions on this hostname. */
  uses: number;
};

export type SnippetContextUse = {
  /** Unix ms of the most recent insertion anywhere. */
  lastUsedAt: number;
  /** Total insertions, across all hostnames. */
  uses: number;
  /** Most recently used hostnames, capped so storage cannot grow without bound. */
  sites: SnippetSiteUse[];
};

export type ContextUsage = Record<string, SnippetContextUse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

/**
 * Reduce any site value to a bare hostname, or `null` if it is not one.
 *
 * Accepting a full URL here is deliberate defence in depth: the content script
 * passes `location.hostname`, but a future caller with `location.href` must not
 * silently persist a path. Anything that cannot be reduced to a plain hostname
 * is rejected rather than partially written.
 */
export function normalizeHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let host = trimmed;
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }

  // Strip userinfo before path/query/fragment, so `user@example.com/path`
  // becomes `example.com` rather than a bogus hostname of `user`.
  const at = host.lastIndexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  host = host.split(/[/?#]/, 1)[0] ?? "";
  host = host.replace(/:\d+$/, "");
  host = host.replace(/^\.+|\.+$/g, "").toLowerCase();

  if (!host || host.includes(":") || host.includes("..") || /\s/.test(host)) {
    return null;
  }
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

function normalizeSites(value: unknown): SnippetSiteUse[] {
  if (!Array.isArray(value)) return [];

  const byHostname = new Map<string, SnippetSiteUse>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const hostname = normalizeHostname(raw.hostname);
    const lastUsedAt = finiteNonNegative(raw.lastUsedAt);
    const uses = finiteNonNegative(raw.uses);
    if (!hostname || lastUsedAt === null || uses === null) continue;

    const existing = byHostname.get(hostname);
    if (!existing) {
      byHostname.set(hostname, { hostname, lastUsedAt, uses });
      continue;
    }
    // Duplicates can arise from a restored or hand-edited value. Keep the
    // strongest signal for each hostname rather than double-counting it.
    byHostname.set(hostname, {
      hostname,
      lastUsedAt: Math.max(existing.lastUsedAt, lastUsedAt),
      uses: Math.max(existing.uses, uses),
    });
  }

  return [...byHostname.values()]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_CONTEXT_SITES_PER_SNIPPET);
}

function normalizeEntry(value: unknown): SnippetContextUse | null {
  if (!isRecord(value)) return null;
  const lastUsedAt = finiteNonNegative(value.lastUsedAt) ?? 0;
  const uses = finiteNonNegative(value.uses) ?? 0;
  const sites = normalizeSites(value.sites);
  if (lastUsedAt === 0 && uses === 0 && sites.length === 0) return null;
  return { lastUsedAt, uses, sites };
}

/**
 * Repair persisted context data on read. Storage can be hand-edited or restored
 * from another build, so corrupt timestamps and stray non-hostname strings must
 * not reach the comparator.
 */
export function normalizeContextUsage(value: unknown): ContextUsage {
  if (!isRecord(value)) return {};

  const entries: Array<[string, SnippetContextUse]> = [];
  for (const [snippetId, raw] of Object.entries(value)) {
    if (!snippetId) continue;
    const entry = normalizeEntry(raw);
    if (entry) entries.push([snippetId, entry]);
  }

  entries.sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt);
  return Object.fromEntries(entries.slice(0, MAX_CONTEXT_SNIPPETS));
}

/** Bounded copy-on-write update after one successful insertion. */
export function recordSnippetUse(
  usage: ContextUsage,
  snippetId: string,
  rawHostname: string,
  now: number = Date.now()
): ContextUsage {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname || !snippetId.trim()) return usage;

  const timestamp = finiteNonNegative(now) ?? Date.now();
  const normalized = normalizeContextUsage(usage);
  const id = snippetId.trim();
  const current = normalized[id] ?? { lastUsedAt: 0, uses: 0, sites: [] };
  const existingSite = current.sites.find((site) => site.hostname === hostname);
  const site: SnippetSiteUse = {
    hostname,
    lastUsedAt: timestamp,
    uses: (existingSite?.uses ?? 0) + 1,
  };
  const sites = [site, ...current.sites.filter((s) => s.hostname !== hostname)]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_CONTEXT_SITES_PER_SNIPPET);

  return normalizeContextUsage({
    ...normalized,
    [id]: {
      lastUsedAt: timestamp,
      uses: current.uses + 1,
      sites,
    },
  });
}

/**
 * Compare two snippets for context only. Like `Array.sort`, a negative result
 * means `a` comes first and a positive result means `b` comes first.
 *
 * Current-hostname relevance comes first: at `github.com`, a snippet used on
 * `github.com` beats one only used elsewhere even if the latter was used an
 * hour ago. Recency then resolves ties, including the common case where
 * neither snippet has ever been used on this hostname. Total uses are a final
 * deterministic tie-break; `0` means "no context preference".
 */
export function compareSnippetContext(
  a: SnippetContextUse | undefined,
  b: SnippetContextUse | undefined,
  rawHostname: string | null
): number {
  const hostname = normalizeHostname(rawHostname);
  const siteA = hostname
    ? a?.sites.find((site) => site.hostname === hostname)
    : undefined;
  const siteB = hostname
    ? b?.sites.find((site) => site.hostname === hostname)
    : undefined;

  const siteUses = (siteB?.uses ?? 0) - (siteA?.uses ?? 0);
  if (siteUses !== 0) return siteUses;

  const siteRecency = (siteB?.lastUsedAt ?? 0) - (siteA?.lastUsedAt ?? 0);
  if (siteRecency !== 0) return siteRecency;

  const recency = (b?.lastUsedAt ?? 0) - (a?.lastUsedAt ?? 0);
  if (recency !== 0) return recency;

  return (b?.uses ?? 0) - (a?.uses ?? 0);
}
