// spec: specs/blocked-sites.spec.md
//
// Single source of truth for the "hide on this site" blocklist. This logic
// previously lived as a file-local, unexported, untested function in
// content.ts, with a second, differently-spelled copy of the normalisation
// logic inside SnippetsSection.tsx. All three consumers now share this module.

/**
 * Normalise user input into a bare, lowercase hostname.
 *
 * Accepts anything a user is likely to paste: a full URL, a URL with a path
 * or query, a hostname with a trailing dot, or mixed case. Browsers always
 * report `location.hostname` lowercase, so patterns must be stored lowercase
 * too or a match silently fails.
 *
 * @example
 * normalizeHostname("  HTTPS://Mail.Example.com/login?x=1#y ") // "mail.example.com"
 * normalizeHostname("*.Example.com")                            // "*.example.com"
 */
export function normalizeHostname(raw: string): string {
  let value = raw.trim().toLowerCase();
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
 * Supports exact matches (e.g. "example.com") and wildcard subdomain patterns
 * (e.g. "*.example.com" matches "mail.example.com" and "app.sub.example.com"
 * but NOT bare "example.com" — the wildcard requires an actual subdomain).
 *
 * Both sides are lowercased, so legacy entries stored with uppercase
 * characters still match.
 */
export function isHostnameBlocked(
  hostname: string,
  blockedPatterns: readonly string[]
): boolean {
  // This runs on every page load, inside initialize(). A throw here would be
  // caught upstream but would leave isBlocked unset, so stay total rather than
  // trusting the storage shape.
  if (!Array.isArray(blockedPatterns)) return false;
  const target = hostname.toLowerCase();
  return blockedPatterns.some((pattern) => {
    const normalized = String(pattern).trim().toLowerCase();
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
 * Idempotently add a hostname to a blocklist, preserving existing order.
 *
 * Comparison is case-insensitive so "Example.com" and "example.com" are
 * treated as the same entry.
 */
export function addBlockedSite(
  blockedPatterns: readonly string[],
  hostname: string
): string[] {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return [...blockedPatterns];
  const alreadyPresent = blockedPatterns.some(
    (pattern) => pattern.trim().toLowerCase() === normalized
  );
  if (alreadyPresent) return [...blockedPatterns];
  return [...blockedPatterns, normalized];
}
