# Module: Update Checker

> Source: `src/lib/update-checker.ts`
> Coverage target: 90%

## Purpose

Queries the GitHub Releases API to determine whether a newer version of the
extension is available. Persists the result to `browser.storage.local` so the
background service worker, popup, and options page can react without making
redundant network requests. Provides a pure `shouldShowUpdateAlert()` helper
so UI components can decide whether to render a banner without any async work.

## Scope

**In scope:**

- `compareVersions(a, b)` — pure semver comparison (major.minor.patch)
- `getCurrentVersion()` — reads `manifest.version` with a safe fallback
- `checkForUpdate()` — fetches GitHub Releases API, compares versions, persists result
- `shouldShowUpdateAlert(latestVersion, dismissedVersion)` — pure predicate for UI

**Out of scope:**

- Scheduling (alarms) — owned by `background.ts`
- Browser notifications — owned by `background.ts`
- Rendering the banner — owned by `Dashboard.tsx`

---

## Public API

### `compareVersions(a: string, b: string): number`

**Description:** Compares two semver strings and returns a numeric ordering value.

**Behavior:**

- MUST return `1` when `a` is strictly greater than `b`
- MUST return `-1` when `a` is strictly less than `b`
- MUST return `0` when `a` equals `b`
- MUST strip a leading `v` prefix from either argument before comparing
- MUST treat non-numeric segments as `0`
- MUST compare only the first three dot-separated parts (major.minor.patch)

**Edge Cases:**

- `"v1.2.3"` vs `"1.2.3"` → `0` (v-prefix stripped)
- `"1.0"` vs `"1.0.0"` → `0` (missing patch defaults to 0)
- `"1.2.3-beta"` vs `"1.2.3"` → `0` (pre-release tag ignored)
- `""` vs `""` → `0`

**Examples:**

```ts
compareVersions("2.0.0", "1.9.9"); // → 1
compareVersions("1.0.0", "1.0.1"); // → -1
compareVersions("1.2.3", "1.2.3"); // → 0
compareVersions("v1.0.0", "1.0.0"); // → 0
```

---

### `getCurrentVersion(): string`

**Description:** Returns the extension's installed version from the manifest.

**Behavior:**

- MUST return the string value of `browser.runtime.getManifest().version`
- MUST return `"0.0.0"` when `browser.runtime` is unavailable (unit test env)

---

### `checkForUpdate(): Promise<void>`

**Description:** Fetches the latest GitHub release and persists update info to storage.

**Behavior:**

- MUST return early (no-op) when `WXT_GITHUB_REPO` env var is absent or empty
- MUST fetch `https://api.github.com/repos/{WXT_GITHUB_REPO}/releases/latest`
- MUST strip a leading `v` from `tag_name` to get the version string
- MUST write `latestVersionItem` with `{ version, htmlUrl, publishedAt }` when the remote version is **strictly newer** than the installed version
- MUST write `null` to `latestVersionItem` when installed version is up-to-date or newer
- MUST always update `latestVersionCheckedAtItem` to the current ISO timestamp (on success or 404)
- MUST skip prereleases (`prerelease: true` in the API response)
- MUST silently return (no write, no throw) when `tag_name` is absent in the response
- MUST capture errors to Sentry and swallow them — MUST NOT throw

**Edge Cases:**

- HTTP 404 → treat as "no releases yet"; update checkedAt timestamp, no throw
- HTTP 500 → capture error, no throw
- Network failure → capture error, no throw
- `prerelease: true` → skip; update checkedAt timestamp, do not write latestVersionItem
- `WXT_GITHUB_REPO` env var is empty string → early return

---

### `shouldShowUpdateAlert(latestVersion: ReleaseInfo | null, dismissedVersion: string): boolean`

**Description:** Pure predicate — returns true when an un-dismissed update is available.

**Behavior:**

- MUST return `false` when `latestVersion` is `null`
- MUST return `false` when `latestVersion.version === dismissedVersion`
- MUST return `true` when `latestVersion` is non-null and version differs from dismissedVersion

**Examples:**

```ts
shouldShowUpdateAlert(null, "");                         // → false
shouldShowUpdateAlert({ version: "1.1.0", ... }, "1.1.0"); // → false
shouldShowUpdateAlert({ version: "1.1.0", ... }, "");      // → true
shouldShowUpdateAlert({ version: "1.1.0", ... }, "1.0.0"); // → true
```

---

## Error Handling

- `checkForUpdate()` MUST never throw. All errors (network, HTTP, storage) are
  captured via `captureError()` and swallowed.
- `getCurrentVersion()` MUST never throw. Falls back to `"0.0.0"`.

## Dependencies

- `fetch` — requires mocking in tests
- `browser.runtime.getManifest()` — mocked by `tests/setup.ts`
- `latestVersionItem`, `latestVersionCheckedAtItem`, `dismissedUpdateVersionItem` — mocked via `wxt/utils/storage`
- `captureError` — mocked via `~/lib/sentry`

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-13 | Initial spec | —      |
