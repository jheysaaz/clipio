# Module: Update Checker

> Source: `src/lib/update-checker.ts`
> Coverage target: 90%

## Purpose

Checks for extension updates via GitHub API.

## Scope

**In scope:** Version comparison, GitHub API integration, caching.
**Out of scope:** Auto-update, UI for updates.

---

## `checkForUpdate(): Promise<UpdateInfo | null>`

**Behavior:**

- Fetches latest version from GitHub API.
- Compares with current manifest version.
- Returns `{ latestVersion, releaseNotes, url }` if newer, else `null`.
- Handles network errors gracefully (returns `null`).
- Caches result for 24h in storage.

---

## `UpdateInfo` Type

```ts
interface UpdateInfo {
  latestVersion: string;
  releaseNotes: string;
  url: string;
}
```

---

## Error Handling

- Returns `null` on network/API failure.
- Does not throw.

---

## Dependencies

- GitHub API.
- Storage for caching.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |