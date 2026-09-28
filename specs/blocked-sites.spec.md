# Spec: Blocked-Site Enforcement

> Source: `src/lib/blocked-sites.ts` (new), `src/entrypoints/content.ts`, `src/entrypoints/background.ts`, `src/components/options/SnippetsSection.tsx`
> Unit tests: `src/lib/blocked-sites.test.ts`
> E2E: `e2e/blocked-sites.spec.ts`
> Status: implemented

## Purpose

A user can add hostnames to a blocklist so snippet expansion never runs on those sites
(banking, email, medical, anything sensitive). Two of the three expansion entry points
honour the blocklist. The third — the manual preview shortcut — does not, and the preview
UI is injected into the page unconditionally.

## Problem

`isBlocked` was resolved in `initialize()` (during `initialize`) and checked by:

| Path                                           | Checked? |
| ---------------------------------------------- | -------- |
| `handleInput`                                  | yes      |
| `handleContentEditableInput`                   | yes      |
| `handleKeyDown` (Space/Tab)                    | yes      |
| `handlePreviewKeyboard` (preview arrows/Enter) | **no**   |
| manual preview shortcut (`Ctrl+Shift+Space`)   | **no**   |

So on a blocked site the user could still press `Ctrl+Shift+Space` and get the **full
snippet list** — every label, every shortcut, and a content preview for each — rendered
into that page's DOM. Pressing Enter would then insert a snippet. That defeats the entire
purpose of the feature.

Worse, `snippetPreviewUI.init()` was called whenever `previewSettings.enabled`, regardless
of `isBlocked`, so on a blocked site the host element and tooltip were injected into the
page and persisted for the session.

The matcher itself (the matcher, now `src/lib/blocked-sites.ts`) was a file-local function that was neither exported
nor tested, so it had **zero** unit coverage and **zero** e2e coverage — the only
normalisation logic lived in an unrelated component (`SnippetsSection.tsx:34`).

## Solution

### 1. Extract the logic into `src/lib/blocked-sites.ts`

Pure, exported, and the single source of truth for the three consumers:

- `normalizeHostname(raw)` — trim, lowercase, strip scheme, strip path/query/fragment,
  strip trailing dots. This was previously duplicated as `normaliseHostname` inside
  `SnippetsSection.tsx`.
- `isHostnameBlocked(hostname, patterns)` — exact match, plus `*.example.com` wildcard
  matching subdomains but deliberately **not** bare `example.com`. Both sides are
  lowercased, so a legacy entry stored with uppercase characters is no longer silently
  ineffective.
- `addBlockedSite(patterns, hostname)` — idempotent add, used by the context-menu path.

### 2. Close the enforcement gaps

- `handlePreviewKeyboard` returns `false` when `isBlocked`.
- The manual preview-shortcut branch bails when `isBlocked`.
- `snippetPreviewUI.init()` is called only when `previewSettings.enabled && !isBlocked`,
  so nothing at all is injected into a blocked page.

`focusout` needs no change: hiding the preview is always safe.

## Acceptance Criteria

- [x] `isHostnameBlocked` is exported from `src/lib/` and unit tested directly.
- [x] Exact host matches.
- [x] `*.example.com` matches `mail.example.com` and `app.sub.example.com`.
- [x] `*.example.com` does **not** match bare `example.com` (documented, deliberate).
- [x] Pattern `example.com` does **not** match `mail.example.com` (exact only).
- [x] Matching is case-insensitive on both sides.
- [x] An empty blocklist never blocks.
- [x] `normalizeHostname` strips scheme, path, query, fragment, trailing dots, and case.
- [x] `addBlockedSite` does not duplicate an existing entry and is order-preserving.
- [x] On a blocked host, the manual preview shortcut does not render any preview row.
- [x] On a blocked host, the preview host element is not injected at all.
- [x] On a blocked host, typing a shortcut does not expand it (pre-existing behaviour, now
      covered by a test for the first time).
- [x] On a **non**-blocked host the preview still works (regression guard).

## Edge Cases

- **`file://` and extension pages** produce an empty `location.hostname`. It matches
  nothing, which is correct: those are not user-configurable and should not be blockable.
- **`about:blank` iframes** receive no content script (the manifest has no `all_frames`).
- **Shadow DOM**: events retarget to the host so `isContentEditable` is false and
  expansion does not run there. Unchanged by this work.
- **Blocked-site entries added while a tab is open** are picked up live by the
  `blockedSitesItem.watch` handler at the `blockedSitesItem` watch handler; no reload needed.

## Non-Goals

- Closing the preview shadow root so page JS cannot read the snippet list on _unblocked_
  sites. Done — see `specs/preview-encapsulation.spec.md`.
- Per-path blocking (blocking only `{{clipboard}}` snippets). All-or-nothing is the
  existing product behaviour.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
