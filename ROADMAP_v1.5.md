# Clipio v1.5 Roadmap

This roadmap keeps Clipio on the current React + WXT stack and focuses v1.5 on a cleaner, safer, faster, and more pleasant extension. It is intentionally detailed so each section can be split into progressive commits or GitHub issues.

## Guiding Principles

- Keep React and WXT. Do not migrate frameworks for v1.5.
- Keep Markdown as the durable snippet format.
- Treat `RichTextEditor` as an implementation boundary so Plate/Slate can be replaced later without rewriting storage, import/export, or content expansion.
- Prioritize user trust: no accidental typed-text logging, clear clipboard behavior, recoverable data, and clear permissions.
- Prioritize repeatable quality: every risky behavior gets a spec, focused tests, and at least one manual QA path.
- Prefer small commits grouped by user-visible outcome.

## Release Goals

- Ship a more trustworthy snippet expansion experience across common websites.
- Make popup/options flows easier to scan, easier to operate by keyboard, and more consistent visually.
- Improve Windows readability for iconography and typography.
- Reduce editor/content-script complexity where possible without rewriting the product.
- Add DX guardrails so regressions are caught before release.
- Improve startup/runtime performance in popup, options, and content scripts.

## Product Decisions

- Snippet preview must be configurable.
- `{{clipboard}}` placeholders should work without explicit opt-in.
- Clipboard behavior should still be documented clearly because it reads clipboard text during expansion.
- Clipio should feel native and utility-like rather than playful or heavily branded.
- Windows visual QA should cover both Windows 10 and Windows 11.
- Rich formatting is core to the product, including formatted text and media-oriented snippet workflows.
- v1.5 should include a dependency update and pruning pass, not only feature work.
- Inline status/toast patterns should be reviewed and consolidated into a normal toast system where that improves clarity.

## Non-Goals for v1.5

- No Svelte migration.
- No complete editor rewrite unless Plate/Slate blocks a critical feature.
- No storage format migration away from Markdown.
- No large visual redesign that delays security/accessibility hardening.
- No new paid/cloud account system.

## Branch and Commit Strategy

- Working branch: `codex-v1.5-roadmap`.
- Use progressive commits by domain:
  - `docs: add v1.5 roadmap`
  - `fix: remove content-script sensitive logging`
  - `test: cover preview privacy behavior`
  - `feat: improve preview accessibility`
  - `feat: improve options navigation`
  - `chore: add lint and accessibility checks`
  - `perf: defer content-script preview work`
  - `style: update icon and font rendering`
- Before each commit:
  - Run `pnpm compile`.
  - Run `pnpm test`.
  - Run `pnpm format:check`.
  - Run targeted e2e tests when UI/content behavior changes.

## Current Snapshot

- TypeScript compile passes.
- Unit tests pass: 773 tests across 27 files.
- Format check currently fails on `src/components/options/app-sidebar.tsx`.
- There is a large dirty worktree from ongoing UI/refactor work.
- The extension uses React 19, WXT, Tailwind CSS v4, Plate/Slate for the rich text editor, Sentry, and Playwright.

## Phase 0: Stabilize the Worktree

### Tasks

- Format the current dirty tree and confirm the only changes are expected.
- Review the large `pnpm-lock.yaml` diff and confirm it is intentional.
- Confirm `pnpm-workspace.yaml` changes are intentional.
- Check whether the new options component split has parity with the previous `OptionsPage`.
- Build Chrome and Firefox once before deeper v1.5 work begins.

### Dependency Update and Pruning

- Update dependencies to the latest safe versions after reading relevant changelogs for major/minor risk.
- Separate dependency updates into their own commit so regressions are easier to bisect.
- Run `pnpm outdated` and classify each package:
  - keep and update
  - keep but pin for compatibility
  - remove because unused
  - replace because it is not the best fit
- Audit direct dependencies for actual usage in source.
- Audit heavy runtime dependencies for bundle impact.
- Review whether any dev dependencies are no longer needed after the options refactor.
- Verify that React 19, WXT, Plate, Sentry, Playwright, Tailwind, and Vite versions remain compatible.
- Avoid automatic major upgrades unless the migration cost is understood.

### Acceptance Criteria

- `pnpm compile` passes.
- `pnpm format:check` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- `pnpm build:firefox` passes.
- Dependency changes are documented with reason and risk level.
- Unused dependencies are removed.
- The current options page opens and every section is reachable.

## Phase 1: Privacy and Security Hardening

### Remove Sensitive Production Logging

- Remove all direct `console.log` calls from the production content script preview path.
- Replace necessary diagnostics with `debugLog`.
- Ensure `debugLog` never stores raw field values, raw query text, clipboard contents, or snippet content.
- Add tests or manual QA notes confirming preview typing does not emit raw values to console.

### Clipboard Safety

- Keep `{{clipboard}}` usable without an opt-in gate.
- Add clear help text explaining that clipboard placeholders read clipboard text during expansion.
- Add docs/store copy language for why `clipboardRead` is requested.
- Consider a non-blocking warning near clipboard placeholder creation if it fits the UI without adding friction.
- Ensure Sentry/debug logs never capture clipboard content.

### Content Script Scope and Blocklist

- Keep `<all_urls>` only if required for the product promise.
- Improve the blocked-sites UX so users understand exact domains vs wildcard domains.
- Add a one-click "Disable Clipio on this site" affordance in popup/options if feasible.
- Add manual QA for blocked sites, wildcard blocked sites, and re-enabling.

### Sentry Relay and Data Scrubbing

- Validate sender checks for every background message path.
- Add sender validation to Sentry relay if not already present.
- Expand scrub tests for nested arrays and unusual keys.
- Ensure Sentry breadcrumbs do not capture console logs containing typed text.

### HTML and Rich Text Insertion

- Re-audit Markdown-to-HTML conversion and contenteditable insertion.
- Add regression tests for dangerous links, HTML-like snippet content, image alt text, and GIF ids.
- Confirm `javascript:`, `data:`, and unknown URL schemes are blocked in links.
- Confirm imported HTML cannot execute script after conversion.

### Permissions Review

- Document why each manifest permission is needed:
  - `storage`
  - `clipboardWrite`
  - `clipboardRead`
  - `contextMenus`
  - `alarms`
  - `notifications`
  - `tabs`
- Decide if `tabs` can be replaced with `activeTab` for any flows.
- Update README/store copy with plain-language permission explanations.

### Acceptance Criteria

- No raw typed input is logged in production.
- Security-sensitive helpers have tests.
- Permissions are documented.
- Clipboard behavior is discoverable.

## Phase 2: Accessibility and Keyboard UX

### Popup Dashboard

- Add accessible label to search input.
- Make the snippet list behave as a real listbox:
  - stable option ids
  - `aria-activedescendant`
  - `aria-selected`
  - keyboard wrapping documented in behavior specs
- Add visible focus styles for selected snippets and toolbar buttons.
- Replace double-click-only inline editing with keyboard-accessible edit actions.
- Add screen-reader status for saved, copied, deleted, and import/recovery states.

### Sidebar Resize

- Convert resize handle from mouse-only `div` to an accessible separator.
- Add keyboard resizing:
  - ArrowLeft / ArrowRight adjust width
  - Home / End choose min/max width
  - Enter or Space toggles collapsed state if appropriate
- Add `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
- Preserve pointer resize behavior.

### Snippet Preview Popup

- Add combobox/listbox semantics to the Shadow DOM preview UI.
- Add selected-item announcements.
- Add `aria-selected` and stable ids to preview rows.
- Ensure Escape closes preview without changing page input.
- Ensure Tab behavior is intentional and documented.
- Add high-contrast styles for selected preview item.

### Options Page

- Ensure sidebar navigation is keyboard accessible and announces active section.
- Add headings with a predictable hierarchy.
- Add labels for switches, sliders, and icon-only buttons.
- Ensure status messages use `role="status"` or `aria-live` where appropriate.
- Verify all controls work at 200% browser zoom.

### Testing

- Add `@axe-core/playwright` or equivalent if acceptable.
- Add accessibility checks for popup and options page.
- Add manual keyboard QA checklist.

### Acceptance Criteria

- Popup can be operated without a mouse.
- Options can be operated without a mouse.
- Preview popup is screen-reader understandable.
- No obvious text overlap at 200% zoom.

## Phase 3: UX Improvements

### First-Run and Empty States

- Add a clear first-snippet creation path.
- Add a small "try this shortcut" onboarding moment after first snippet creation.
- Improve empty state hierarchy:
  - create snippet
  - import snippets
  - open options
- Avoid marketing text; keep it task-focused.

### Snippet Creation and Editing

- Make shortcut conflict errors clearer and more actionable.
- Consider showing conflicting snippet name as a clickable target.
- Add "Save and create another" if users often batch-create snippets.
- Add undo affordance after delete if storage architecture makes it safe.
- Keep unsaved changes guard, but ensure it does not trap keyboard users.

### Snippet Discovery

- Improve search ranking:
  - exact shortcut match first
  - label match second
  - tag match third
  - content match last
- Add tag filtering if the UI can stay compact.
- Consider recent/frequent snippets as a default sort option.

### Preview Experience

- Reduce preview noise on pages where `/` is commonly typed.
- Make preview behavior configurable.
- Support automatic preview from prefix.
- Support keyboard-shortcut-only preview.
- Support disabling preview.
- Allow trigger prefix configuration if it remains stable and understandable.
- Add a visible preview setting explaining trigger behavior.
- Improve preview visual design while keeping it simple and minimal:
  - clearer selected row state
  - better spacing and alignment
  - readable shortcut treatment
  - calmer border/shadow
  - no heavy branding
  - no decorative clutter
- Make preview feel like a native utility menu, closer to a compact command palette than a promotional surface.
- Add empty/loading states only if they help users understand what happened.
- Ensure preview remains visually legible on Windows 10 and Windows 11.

### Toast and Status Feedback

- Inventory current inline feedback patterns:
  - inline errors
  - warning banners
  - saved/copied labels
  - import/export success messages
  - review/update banners
- Decide which messages should stay inline because they are contextual and persistent.
- Move transient feedback to a normal toast system:
  - saved
  - copied
  - import complete
  - export complete
  - settings saved
  - non-blocking failures
- Add toast color variants:
  - success
  - info
  - warning
  - destructive/error
- Keep toasts accessible:
  - live region announcements
  - pause/long enough duration
  - keyboard dismiss if interactive
- Avoid using toasts for critical data-loss or permission warnings; those should remain inline/banners.

### Import/Export

- Make import result feedback more specific:
  - created
  - skipped duplicates
  - failed
  - media included
- Add "export includes images" messaging when ZIP export is used.
- Add restore-from-backup messaging that is calm and clear.

### Review and Feedback

- Keep review prompt respectful:
  - never after recent errors
  - never during first-use confusion
  - clear dismiss behavior
- Make feedback path easy to find from options.

### Acceptance Criteria

- New users can create and test a snippet in under one minute.
- Existing users can find and edit snippets faster.
- Preview behavior is configurable enough to avoid annoyance without removing the fast path for users who like it.
- Transient feedback uses consistent toast patterns.
- Critical feedback remains inline and hard to miss.

## Phase 4: Design System, Icons, and Typography

### Windows Icon Readability

Problem: thin Lucide strokes and small monochrome icons can read poorly on Windows displays, especially at 100% scaling, low-DPI monitors, and browser extension popup sizes.

Options to evaluate:

1. Keep Lucide, increase stroke and size defaults.
   - Use `strokeWidth={2}` for action icons.
   - Avoid icons below 16px except decorative metadata.
   - Use 18px or 20px for primary toolbar actions.
   - Pros: minimal dependency change.
   - Cons: Lucide still has a thin-line personality.

2. Keep Lucide but create Clipio icon wrappers.
   - Add `ActionIcon`, `NavIcon`, and `StatusIcon` components.
   - Centralize size, stroke width, and accessibility defaults.
   - Pros: consistent and easy to tune for Windows.
   - Cons: small abstraction cost.

3. Switch selected UI icons to filled/duotone alternatives.
   - Candidates to evaluate:
     - Phosphor Icons
     - Radix Icons
     - Heroicons
     - Material Symbols rounded
   - Pros: potentially better readability.
   - Cons: mixed icon language if only partially migrated.

4. Custom product-critical icons only.
   - Keep Lucide for common actions.
   - Create custom icons for snippets, placeholder chips, expansion, import/export, and storage state.
   - Pros: stronger product identity.
   - Cons: design effort.

Recommended v1.5 path:

- Evaluate whether Lucide remains the best iconset for this product.
- Do not migrate the whole icon library unless the readability pass shows a clear benefit.
- Create icon wrapper components before any broad migration.
- Increase default action icon size/stroke if staying on Lucide.
- Run a Windows 10 and Windows 11 readability pass before deciding on a future icon migration.
- If migrating, prefer one coherent icon system rather than mixing multiple icon languages casually.

### Default Font

Current product uses local Inter variable fonts. Inter is generally good, but on Windows small text can feel softer than Segoe UI in native, utility-like extension surfaces.

Options to evaluate:

1. Keep Inter everywhere.
   - Pros: consistent brand, bundled, predictable.
   - Cons: may be less native/readable on Windows at small sizes.

2. Use system UI stack for app chrome and keep Inter for marketing/brand moments.
   - Suggested stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
   - Pros: Windows gets Segoe UI; macOS gets San Francisco.
   - Cons: cross-platform visual differences.

3. Use Segoe-first stack on Windows through CSS fallback.
   - Pros: targeted readability.
   - Cons: harder to reason about cross-platform screenshots.

4. Test Atkinson Hyperlegible for accessibility.
   - Pros: strong readability.
   - Cons: distinctive; may not match current product tone.

Recommended v1.5 path:

- Switch dense UI surfaces to system UI stack.
- Keep monospace shortcuts in a readable monospace stack.
- Evaluate whether Inter should remain for headings/brand only.
- Test popup/options on Windows 10, Windows 11, macOS, dark mode, and 200% zoom.

### Visual System Cleanup

- Keep cards to repeated items and contained settings groups.
- Avoid nested cards.
- Standardize border radius:
  - controls: 8px
  - compact chips/badges: 4-6px
  - modals: 10-12px only if visually justified
- Standardize control heights:
  - compact buttons: 32px
  - inputs: 32-36px
  - icon buttons: 32px
- Standardize status colors for success, warning, danger, info.
- Review dark mode contrast.

### Acceptance Criteria

- Icons are legible at 100% Windows scaling.
- Popup and options remain readable at 200% zoom.
- Font choice is documented.
- Design tokens are centralized enough that future visual tuning is easy.

## Phase 5: Code Simplicity and Architecture

### Editor Boundary

- Keep Plate inside `src/components/editor`.
- Ensure callers only know:
  - `value: string`
  - `onChange(value: string)`
  - `openCommandMenu()`
- Avoid leaking Plate types outside editor internals.
- Move editor-only helpers into editor folder.
- Keep Markdown serialization/deserialization heavily tested.
- Review whether Plate/Slate remain the best dependencies for Clipio's actual editor needs:
  - rich text marks
  - links
  - inline placeholder chips
  - image/GIF chips with resizing
  - slash command menu
  - Markdown storage
  - import/export conversion
- Compare realistic alternatives before committing to deeper Plate investment:
  - TipTap/ProseMirror
  - Lexical
  - lightweight Markdown-first editor with custom tokens
  - staying on Plate with stricter isolation
- Treat any editor migration as a separate future project unless v1.5 uncovers a blocking issue.
- Document the decision in the roadmap or an ADR-style note.

### General Dependency Review

- Identify dependencies that are convenience-only and easy to replace with small local helpers.
- Identify dependencies that are strategic and should remain:
  - WXT
  - React
  - editor package chosen for v1.5
  - Playwright
  - Vitest
- Identify dependencies with runtime/privacy implications:
  - Sentry
  - Giphy integration
  - canvas-confetti
- Identify dependencies with bundle-size implications:
  - Plate/editor packages
  - Sentry packages
  - icon library
  - animation/utility packages
- Remove unused imports and unused packages after each migration/refactor.

### Content Script Modularity

- Split large content script responsibilities:
  - initialization and storage watchers
  - shortcut matching
  - preview orchestration
  - DOM insertion
  - clipboard placeholder reading
  - confetti
  - telemetry/debug
- Move pure logic into testable `src/lib/*` modules.
- Keep DOM-heavy code small and manually tested.

### Options Page Components

- Finish the component split with clear ownership:
  - dashboard metrics
  - snippets and import/export
  - appearance
  - images
  - advanced/developer tools
- Avoid duplicating storage reads across sections when one hook can own them.
- Keep advanced/debug tools visibly separate from normal settings.

### Storage

- Document sync/local/idb responsibilities in code and README.
- Add a "storage health" helper that UI can consume.
- Avoid each UI component recomputing storage usage differently.
- Ensure fallback mode messaging is clear and tested.

### Internationalization

- Replace hardcoded strings introduced during refactors.
- Add locale check to CI.
- Add a convention for new strings:
  - English first
  - Spanish same PR
  - no user-facing literal strings in components

### Acceptance Criteria

- Plate types do not leak beyond editor module except tests/specs.
- Content script is easier to test in pieces.
- Options sections have clear boundaries.
- Locale checks run in CI.

## Phase 6: Performance

### Popup Performance

- Keep heavy editor views lazy-loaded.
- Avoid loading editor code until creating or editing a snippet.
- Memoize filtered snippets and search ranking when snippet count grows.
- Avoid serializing editor state more often than necessary.
- Add simple timing logs behind debug mode for popup load and snippet list render.

### Options Performance

- Lazy-load heavy sections if needed:
  - import wizard
  - image tools
  - developer diagnostics
- Avoid running expensive storage scans on every options mount.
- Cache storage stats with explicit refresh.

### Content Script Performance

- Avoid expensive work on every input event.
- Never log raw input values.
- Debounce preview detection carefully.
- Build shortcut index once per snippet cache update.
- Initialize preview UI only when preview is enabled, or lazily on first trigger.
- Avoid injecting fonts/UI into every page if the user disabled preview.

### Bundle Size

- Analyze production bundle after v1.5 refactors.
- Check whether Plate editor remains isolated from content script and initial popup shell.
- Review `canvas-confetti` loading path.
- Review Sentry integration cost per context.
- Review icon library cost and tree-shaking behavior.
- Review whether new toast implementation adds meaningful bundle weight.

### Acceptance Criteria

- Content script does minimal work when idle.
- Popup opens quickly with large snippet sets.
- Options page does not run storage-heavy work unnecessarily.
- Bundle analysis is captured before release.

## Phase 7: Developer Experience

### Linting and Static Checks

- Add ESLint with:
  - TypeScript rules
  - React hooks rules
  - JSX accessibility rules
  - no accidental `console.log`
  - no floating promises where unsafe
- Keep Prettier as formatting authority.
- Add `pnpm lint` and `pnpm lint:fix`.
- Add lint to CI.

### Testing

- Add focused tests for:
  - privacy-safe debug logging
  - preview trigger behavior
  - blocked-sites matching
  - permission-sensitive message validation
  - serialization edge cases
- Add e2e coverage for:
  - popup create/edit/delete
  - options navigation
  - content expansion on input
  - content expansion on contenteditable
  - preview selection with keyboard
  - blocked site behavior

### Manual QA

- Create a v1.5 manual QA checklist:
  - Chrome
  - Firefox
  - macOS
  - Windows
  - light/dark
  - 100% and 200% zoom
  - first install
  - update from v1.4.x
  - import/export with media
  - sync quota fallback
  - offline behavior

### CI and Release

- CI should run:
  - format check
  - compile
  - lint
  - unit tests
  - locale check
  - e2e tests
  - Chrome build
  - Firefox build
- Release checklist should include:
  - version bump
  - changelog
  - store copy permissions review
  - screenshots if UI changed
  - Sentry release configured
  - source maps uploaded only in production

### Acceptance Criteria

- New contributors get reliable local commands.
- CI catches format, type, lint, locale, unit, and e2e failures.
- Manual QA is explicit enough to repeat before every store submission.

## Phase 8: Data Safety and Reliability

### Backup and Recovery

- Make IDB backup status visible in advanced/storage settings.
- Add "last backup updated" if feasible.
- Add recovery flow copy that explains what happened and what will be restored.
- Add tests around sync wipe detection and recovery prompt behavior.

### Quota Handling

- Improve sync quota warning:
  - explain why sync paused
  - explain what local mode means
  - link to export backup
- Add a storage usage meter that matches actual sync calculation.
- Avoid retry loops that can duplicate snippets or confuse users.

### Import Deduplication

- Ensure duplicate detection is deterministic.
- Make import report understandable.
- Consider dry-run import preview for large files.

### Acceptance Criteria

- Users understand where snippets are stored.
- Users can export and recover data with confidence.
- Quota fallback is calm, visible, and recoverable.

## Suggested Issue Breakdown

1. Remove sensitive content-script console logs.
2. Add privacy-safe debug logging tests.
3. Fix Prettier failure and stabilize current tree.
4. Add ESLint and no-console rule.
5. Add accessible dashboard search/listbox behavior.
6. Add keyboard-accessible sidebar resize.
7. Add accessible preview popup semantics.
8. Replace double-click-only snippet inline editing.
9. Improve clipboard placeholder documentation and UI copy.
10. Document manifest permissions.
11. Add Sentry relay sender validation.
12. Add Markdown/HTML security regression tests.
13. Create icon wrapper components.
14. Evaluate iconset migration options.
15. Run Windows icon readability pass.
16. Decide font stack and update tokens.
17. Add normal toast system with color variants.
18. Migrate transient inline feedback to toasts.
19. Split content script into smaller modules.
20. Tighten editor boundary and Plate type leakage.
21. Review editor dependency fit and alternatives.
22. Add dependency update/pruning pass.
23. Add locale check to CI.
24. Add Playwright accessibility checks.
25. Add v1.5 manual QA checklist.
26. Add storage health UI copy.
27. Improve import/export result summaries.
28. Add bundle/performance analysis step.
29. Build Chrome/Firefox release candidates.

## Open Decisions

- Should dense UI use system fonts instead of bundled Inter?
- Should Clipio stay on Lucide, migrate iconsets, or introduce wrappers first and decide after visual QA?
- Should the popup prioritize compact density or larger touch-friendly controls?
- Should import/export move out of snippets settings into a dedicated data section?
- Should advanced/developer tools be hidden behind an explicit "Developer mode" toggle?
- Should v1.5 include a public changelog file?
- Which toast library/pattern should be used: custom local toast, Radix-compatible primitive, Sonner, or another lightweight option?
- Should editor dependency evaluation produce an ADR before implementation continues?

## Questions for Product Direction

- Who is the primary v1.5 user: solo power user, support agent, developer, sales/ops teammate, or general productivity user?
- Which websites must expansion work best on for release confidence?
- How important are GIFs/images compared with fast text expansion?
- Do we expect users to manage hundreds of snippets?
- Do we expect teams to share snippet packs soon?

## Definition of Done for v1.5

- No known production privacy leaks through logs or telemetry.
- Key popup/options flows are keyboard accessible.
- Content expansion and preview have targeted tests.
- Windows icon/font readability has been reviewed and documented.
- DX commands are documented and passing.
- Chrome and Firefox builds are verified.
- Manual QA checklist is completed.
- Release notes clearly explain security, UX, and reliability improvements.
