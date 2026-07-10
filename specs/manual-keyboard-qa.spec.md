# Manual Keyboard QA Checklist

> spec: ROADMAP_v1.5.md#Phase-2
>
> Run through this checklist before every v1.5 release to verify keyboard
> accessibility across popup, options, and snippet preview.

## Popup Dashboard

- [ ] Tab through all interactive elements in the popup.
- [ ] Search input is focusable via Ctrl+K / Cmd+K.
- [ ] ArrowDown/ArrowUp navigates through the snippet listbox.
- [ ] Enter on a selected snippet opens it for editing/viewing.
- [ ] Escape cancels editing or closes detail view.
- [ ] F2 (or equivalent) initiates inline editing of label/shortcut.
- [ ] Status announcements (saved/deleted/updated) are spoken by screen reader.
- [ ] Sidebar resize handle is focusable via Tab.
- [ ] ArrowLeft/ArrowRight on resize handle adjusts sidebar width.
- [ ] Home/End on resize handle snaps to min/max width.
- [ ] Toolbar buttons (add snippet, settings) have visible focus indicators.
- [ ] Delete snippet flow works without mouse (select → Delete key → confirm).

## Options Page

- [ ] Tab through all controls in each section.
- [ ] Sidebar navigation is keyboard-accessible (Arrow keys or Tab).
- [ ] Active section is visually indicated (aria-current).
- [ ] All switches can be toggled with Space/Enter.
- [ ] All toggle buttons expose correct aria-checked state.
- [ ] InfoTooltip icons are focusable and tooltip appears on focus.
- [ ] Dialog (import wizard, delete confirm) traps focus.
- [ ] Escape closes dialogs.
- [ ] Status messages (Saved, Switched, Cleared) are announced by screen reader.
- [ ] All controls work at 200% browser zoom (no overlap, no cutoff).

## Snippet Preview (Content Script)

- [ ] Preview popup opens on trigger prefix (default: "/").
- [ ] ArrowDown/ArrowUp navigates through preview options.
- [ ] Enter or Tab selects highlighted option.
- [ ] Escape dismisses preview without action.
- [ ] Selected option has visible highlight.
- [ ] Screen reader announces selected option (label, index+1 of total).

## Screen Reader (VoiceOver / NVDA)

- [ ] Popup snippet list is announced as "listbox" with N items.
- [ ] Selected snippet is announced as "selected".
- [ ] Status messages are announced automatically.
- [ ] Options sidebar indicates current section.
- [ ] Options controls announce their state (checked/unchecked, pressed/not pressed).
- [ ] Preview popup list is announced with role and count.

## Browsers and Platforms

- [ ] Chrome on macOS — all keyboard checks pass.
- [ ] Chrome on Windows 10 — all keyboard checks pass.
- [ ] Chrome on Windows 11 — all keyboard checks pass.
- [ ] Firefox on macOS — all keyboard checks pass.
- [ ] Firefox on Windows — all keyboard checks pass.

## Zoom and Display

- [ ] Popup is usable at 200% browser zoom.
- [ ] Options page is usable at 200% browser zoom.
- [ ] No text is truncated or overlapping at 200% zoom.
- [ ] High contrast mode (Windows): selected items have visible outline.
