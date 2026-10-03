# Module: Shortcut Boundary

> Source: `src/lib/content-helpers.ts` (`isShortcutBoundary`), consumed by
> `findSnippetMatch` and `src/lib/preview-helpers.ts` (`detectPreviewTrigger`)
> Coverage target: 95% (pure, no DOM)

## Purpose

A single definition of *where a shortcut or preview trigger may begin*, shared by
the two code paths that decide it.

## Problem

The boundary was "whitespace only", and both the auto-expansion and the preview
palette consulted it independently. That rule silently made a whole class of
fields unusable:

- The preview palette is triggered by typing the prefix. In a **pre-filled**
  field — a contenteditable holding an existing document — the caret sits at the
  end of existing prose, so the prefix is preceded by a full stop, not a space.
  The palette never opened and expansion never ran.
- This is precisely the manual QA harness's `#qa-ce-rich` field, and precisely
  the case where a user is *editing content they already have* rather than
  starting from an empty box.

The original rule is still needed, and the reported bug is not an argument
against it: without it, `https://example.com`, `mailto:a@b.c`, `src/index` and
`report-final` all expand or pop the palette open mid-token.

## Behavior

- `isShortcutBoundary(char)` returns `true` when `char` is:
  - whitespace or a newline (the original rule), or
  - sentence punctuation / a bracket or quote delimiter: `. , ; ! ? … ( ) [ ] { } " ' ‘ ’ “ ” « »`.
- Returns `false` for `undefined`, so a caller must handle "start of text"
  explicitly rather than having an absent character read as a boundary.
- `:` `/` `\` `-` `_` `@` `&` `=` `+` `#` `%` `~` `|` and every alphanumeric are
  **not** boundaries. This is a whitelist on purpose: those are the characters
  URLs, paths, file names and identifiers are assembled from, and a blacklist
  would have to enumerate every case a future one invents.

## Excluded fields: password inputs

`isShortcutBoundary` decides *where* a trigger may start inside an eligible field.
A separate gate, `isPasswordInput` in `src/entrypoints/content.ts`, decides
whether the field is eligible at all. It matches on the `type` **attribute**,
covering all three credential states:

| Attribute | `input.type` (IDL) | Excluded |
| --------- | ------------------ | -------- |
| `password` | `"password"` | yes |
| `current-password` | `"text"` | yes |
| `new-password` | `"text"` | yes |

The last two are separate states in the HTML standard rather than aliases of the
Password state, so the IDL getter reports `"text"` for them — and they are exactly
the fields on sign-in and change-password forms. Reading the IDL property would
silently miss both.

- No auto-expansion, and no expansion on the Space/Tab immediate path.
- No preview palette, including via the Ctrl+Shift+Space shortcut that otherwise
  renders the whole snippet list at the caret.
- Checked in `handleInput`, in `handleKeyDown`, in the manual-shortcut branch, and
  again inside `insertSnippetInInput`, so the insertion path is unreachable even
  if a preview were somehow opened.
- Deliberately **not** checked in the capture-phase `input` listener: it must run
  so that `handleInput`'s first action — consuming the one-shot `justExpanded`
  flag — happens for every keystroke. Bailing out earlier would let the flag
  survive a password-field keystroke and swallow the next genuine one elsewhere.

Rationale: expanding would write plaintext snippet content into a credential
field, and the palette paints snippet labels and content next to the password.
`e2e/helpers/manual-qa.html` asserts this as its negative case, and
`e2e/manual-qa-fields.spec.ts` covers it.

## Edge Cases

- `"…context."` + `/hi` → boundary (`.`) → matches. The reported bug.
- `"ohhi"` → not a boundary (`h`) → no match. Unchanged.
- `"https://x/hi"` → not a boundary (`:` and `/`) → no match.
- Shortcut at offset 0 → matches; handled by the caller, not by the predicate.
- **Accepted cost:** because `.` is a boundary, a shortcut whose name is a common
  file extension now fires mid-token — `notes.md`, `index.ts`, `app.js`,
  `style.css`, `data.json` expand if the user owns snippets with those shortcuts.
  This is inherent to allowing a full stop and is the trade the reported bug
  requires; a user who hits it can rename the snippet or set a trigger prefix
  that does not collide. Multi-part paths (`src/index`, `a/b/c.ts`) remain
  suppressed because the char before their `/` is a letter.

- `"…context."` + `/hi` → boundary (`.`) → matches. The reported bug.
- `"ohhi"` → not a boundary (`h`) → no match. Unchanged.
- `"https://x/hi"` → not a boundary (`:` and `/`) → no match.
- Shortcut at offset 0 → matches; handled by the caller, not by the predicate.

## Change History

| Date       | Change                                          | Author |
| ---------- | ----------------------------------------------- | ------ |
| 2026-10-02 | Initial spec (boundary widened to punctuation)  | —      |
| 2026-10-02 | Recorded the `notes.md` false-trigger cost      | —      |
| 2026-10-02 | Password gate extended to `current-password` / `new-password` | — |
