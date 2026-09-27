# Module: Update Checker

> Source: `src/lib/update-checker.ts`
> Tests: `src/lib/update-checker.test.ts`
> Coverage target: 90%

## Purpose

Checks for extension updates via the GitHub Releases API, and owns the contract for
"open a link to a release page".

## Scope

**In scope:** Version comparison, GitHub API integration, release-URL validation.
**Out of scope:** Auto-update, release notes rendering, the update banner UI.

---

## Exported API

```ts
compareVersions(a: string, b: string): number
getCurrentVersion(): string
sanitizeReleaseUrl(raw: string | undefined | null): string
openReleasePage(htmlUrl: string): Promise<boolean>
checkForUpdate(): Promise<void>
shouldShowUpdateAlert(...): boolean
type ReleaseInfo
```

Note the real signature is `checkForUpdate(): Promise<void>`. An earlier revision of this
spec documented `Promise<UpdateInfo | null>` and an `UpdateInfo` interface; neither exists.
The function communicates its result through the `latestVersionItem` storage item, and
never throws.

---

## `sanitizeReleaseUrl(raw)`

Allowlist for the release page link. Returns the URL when acceptable, `""` when rejected.

**Accepts only:** `https:` with hostname exactly `github.com` or `www.github.com`.

A GitHub API response always carries an `html_url` of the form
`https://github.com/{owner}/{repo}/releases/tag/{tag}`, so anything else means the response
was tampered with or mis-parsed.

**Rejects:** lookalike hosts (`github.com.evil.test`), unrelated hosts, subdomains of
github.com (`gist.github.com`), `http:`, `javascript:`, `data:`, `file:`, unparseable
strings, empty/whitespace strings, `undefined`, `null`, and non-string values at runtime.

Hostname comparison is case-insensitive.

**Threat model.** `host_permissions` pins the fetch to `https://api.github.com/*`, so a
plain network attacker cannot reach this. The realistic attacker is a TLS-intercepting
proxy with an installed root CA — a corporate proxy, malware, or a developer machine with
a debugging CA, which is a very common configuration. Such a proxy can return any
`html_url` it likes, and the extension would relay it behind a genuine system notification
reading "Update available: X.Y.Z". Chrome blocks `javascript:` in `tabs.create`, so the
outcome is credential phishing, not code execution.

---

## `openReleasePage(htmlUrl)`

The single chokepoint for "the user clicked a link to a release". Re-validates rather than
trusting the stored value, because `latestVersionItem` is a storage item that a future
writer — or a hand-edited profile — could put anything into.

Returns `true` when a tab was opened, `false` when the URL was rejected or `tabs.create`
threw. Callers do not need their own validation, and a new call site cannot forget it.

Three call sites route through it: the update notification click handler in
`background.ts`, the popup banner in `Dashboard.tsx`, and the options dashboard card in
`DashboardSection.tsx`. The notification path is the highest-value target, because it fires
behind a system notification the user trusts.

---

## `checkForUpdate()`

- Fetches `https://api.github.com/repos/{WXT_GITHUB_REPO}/releases/latest`.
- Returns immediately when `WXT_GITHUB_REPO` is unset.
- `404` is not an error: it means no releases are published yet.
- Skips prereleases.
- Strips a leading `v` from `tag_name`.
- When the remote version is strictly newer, stores `{version, htmlUrl, publishedAt}` in
  `latestVersionItem`; otherwise stores `null` to clear stale update info.
- **Records `latestVersionCheckedAtItem` on every path that completes**, including 404,
  prerelease, missing version, and a rejected release URL. Recording it on the rejection
  path is deliberate: a tampered response must not cause a fetch storm.
- Never throws. All errors are captured to Sentry and swallowed.

### Throttling

`shouldCheckForUpdate(lastCheckedAt, now)` is a pure gate, and `checkForUpdate()` consults it
**before** fetching. A check within `UPDATE_CHECK_MIN_INTERVAL_HOURS` (24) of the last recorded
check is skipped and **no network request is made**.

The gate is necessary because the alarm is not a throttle on its own. `background.ts` calls
`checkForUpdate()` at the top level of the service worker as well as on the 6-hour alarm, so it
runs on _every_ wake-up — and an MV3 worker is evicted after roughly 30 seconds idle, which is
many times a day. Unauthenticated GitHub API calls are rate limited per IP.

The gate **fails open**: no timestamp, an unparseable one, or one in the future all mean
"check". The asymmetry is deliberate — an unnecessary check costs one API call, whereas wrongly
concluding "recently checked" means the user silently never learns about an update.

A **failed** check also records the timestamp. Without that, a `403` from the rate limiter (an
`!response.ok`, so it throws) left the timestamp untouched and the client retried on every
wake-up, keeping its own rate limit alive. The trade-off is that a failed check delays the next
attempt by up to 24 hours, which is the right way round: a day's delay on an update notice is
harmless, whereas a throttled client that never backs off never recovers.

An earlier revision of this spec claimed "Caches result for 24h in storage" while the
implementation only ever wrote the timestamp. The claim described the intent; the code now
implements it.

---

## Error Handling

- Never throws. Network failures, non-2xx responses, and malformed bodies are captured to
  Sentry via `captureError`.
- A release URL that fails validation is captured and the update is dropped entirely. A
  banner whose link cannot be trusted is worse than no banner.

---

## Dependencies

- GitHub Releases API (`host_permissions: https://api.github.com/*`).
- `latestVersionItem`, `latestVersionCheckedAtItem`, `dismissedUpdateVersionItem`.
- `browser.tabs` for `openReleasePage`.

---

## Change History

| Date       | Change                                                                                                                                                                                                                     | Author |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                                                                                                                                                                                               | —      |
| 2026-09-26 | Corrected the `checkForUpdate` signature; removed the `UpdateInfo` type and the false 24h-caching claim. Documented `sanitizeReleaseUrl` and `openReleasePage`.                                                            | —      |
| 2026-09-27 | Implemented the 24h throttle the previous revision had claimed but the code never did, and made a failed check record the timestamp so a rate-limited client backs off. spec: specs/test-infrastructure.spec.md (Wave 4.2) | —      |
