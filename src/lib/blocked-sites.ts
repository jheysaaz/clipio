//
// Single source of truth for the "hide on this site" blocklist. This logic
// previously lived as a file-local, unexported, untested function in
// content.ts, with a second, differently-spelled copy of the normalisation
// logic inside SnippetsSection.tsx. All three consumers now share this module.

/** A `/pattern/flags` entry, parsed once at validation time and again at match time. */
const REGEX_ENTRY = /^\/(.+)\/([a-z]*)$/s;

/**
 * Parse a full-regex blocklist entry (e.g. `/mail\..*\.example\.com/i`).
 *
 * Returns `null` for plain hostnames, half-typed patterns and invalid regexes.
 * `g`/`y` are rejected because repeated `.test()` calls would alternate;
 * other invalid flags are rejected by the RegExp constructor.
 */
export function parseRegexEntry(raw: string): RegExp | null {
  const match = REGEX_ENTRY.exec(raw.trim());
  if (!match) return null;
  const [, source, flags] = match;
  if (!source || source.length > 200 || /[gy]/.test(flags)) return null;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/**
 * Normalise user input into a bare, lowercase hostname.
 *
 * Accepts anything a user is likely to paste: a full URL, a URL with a path
 * or query, a hostname with a trailing dot, or mixed case. Browsers always
 * report `location.hostname` lowercase, so patterns must be stored lowercase
 * too or a match silently fails. Valid `/pattern/flags` entries pass through
 * untouched: their source is case-sensitive and their slashes are delimiters.
 *
 * @example
 * normalizeHostname("  HTTPS://Mail.Example.com/login?x=1#y ") // "mail.example.com"
 * normalizeHostname("*.Example.com")                            // "*.example.com"
 * normalizeHostname("/MAIL\\./i")                              // "/MAIL\\./i"
 */
export function normalizeHostname(raw: string): string {
  const trimmed = raw.trim();
  if (parseRegexEntry(trimmed)) return trimmed;
  let value = trimmed.toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0].split("?")[0].split("#")[0];
  // Drop an explicit port. Browsers report location.hostname without one, so
  // keeping it would produce an entry that can never match. The bracket form
  // keeps IPv6 literals intact ("[::1]:8080" -> "[::1]").
  value = value.replace(/:\d+$/, "");
  value = value.replace(/\.+$/, "");
  return value;
}

/**
 * Returns true if `hostname` is covered by any entry in `blockedPatterns`.
 *
 * Supports exact matches (e.g. "example.com"), wildcard subdomain patterns
 * (e.g. "*.example.com" matches "mail.example.com" and "app.sub.example.com"
 * but NOT bare "example.com" — the wildcard requires an actual subdomain), and
 * full regex entries (e.g. `/^mail\..*\.example\.com$/i`).
 *
 * Both sides are lowercased for hostname entries, so legacy entries stored
 * with uppercase characters still match. Regex entries use their own flags.
 */
export function isHostnameBlocked(
  hostname: string,
  blockedPatterns: readonly string[]
): boolean {
  // This runs on every page load, inside initialize(). A throw here would be
  // caught upstream but would leave isBlocked unset, so stay total rather than
  // trusting the storage shape.
  if (!Array.isArray(blockedPatterns)) return false;
  const target = normalizeHostname(hostname);
  if (!target) return false;
  return blockedPatterns.some((pattern) => {
    const regex = parseRegexEntry(String(pattern));
    if (regex) return regex.test(target);
    // Normalize at MATCH time, not just at write time. Entries stored before
    // the writer learned to strip ports and schemes are still sitting in users'
    // storage; without this a legacy "mail.example.com:443" would never match
    // location.hostname and the site would silently stay unblocked.
    const normalized = normalizeHostname(String(pattern));
    if (!normalized) return false;
    if (normalized.startsWith("*.")) {
      const base = normalized.slice(2); // e.g. "example.com"
      if (!base) return false;
      return target.endsWith("." + base);
    }
    return target === normalized;
  });
}

/**
 * Idempotently add a hostname or regex entry to a blocklist, preserving order.
 *
 * Hostnames compare case-insensitively; regex entries compare on their exact
 * source and flags, because changing case inside a regex can change its meaning.
 * Callers can detect a duplicate by comparing the returned length.
 */
export function addBlockedSite(
  blockedPatterns: readonly string[],
  hostname: string
): string[] {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return [...blockedPatterns];
  // Only a preserved regex entry can start with "/" after normalisation.
  const isRegex = normalized.startsWith("/");
  const alreadyPresent = blockedPatterns.some((pattern) => {
    const existing = String(pattern).trim();
    return isRegex
      ? existing === normalized
      : existing.toLowerCase() === normalized;
  });
  if (alreadyPresent) return [...blockedPatterns];
  return [...blockedPatterns, normalized];
}

/**
 * The domain a favicon can be fetched for, or `null` for input that is not yet
 * a usable hostname (including regex entries, which have no single domain).
 *
 * Used both for stored tiles and for the live preview in the add field, so a
 * half-typed pattern shows the neutral globe rather than a broken image.
 */
export function getFaviconDomain(raw: string): string | null {
  const value = raw.trim();
  if (parseRegexEntry(value)) return null;
  const host = normalizeHostname(value).replace(/^\*\./, "");
  if (!host.includes(".")) return null;
  return /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/i.test(host) ? host : null;
}
