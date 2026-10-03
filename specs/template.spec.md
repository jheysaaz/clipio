# Module: Template System

> Coverage target: N/A — see below

## Status: this module does not exist

> **Removed as fiction.** This spec described `src/lib/template.ts` exporting
> `processTemplate(template, variables)` to substitute `{{variable}}`
> placeholders. **Neither the file nor the function has ever existed in this
> repository** — `git log --all -- src/lib/template.ts` returns nothing, so this
> was not drift from a deleted module. The spec described planned work as though
> it were shipped behaviour.
>
> Found by the drift gate in `specs/coverage-honesty.spec.md`.

## Where placeholder substitution actually lives

Snippet placeholders are substituted by `processSnippetContent` in
`src/lib/content-helpers.ts`, which is specified in full by
[`specs/content-expansion.spec.md`](./content-expansion.spec.md).

That function handles `{{clipboard}}`, `{{date:format}}`, `{{datepicker:…}}` and
`{{cursor}}`. Media placeholders (`{{image:id}}`, `{{gif:id:width}}`) are handled
separately by `src/lib/media-placeholders.ts`, specified in
[`specs/media-placeholders.spec.md`](./media-placeholders.spec.md).

Note there is deliberately **no generic `{{name}}` substitution**: every
placeholder is a known, individually-specified feature. An unknown placeholder
is left verbatim rather than resolved to an empty string, so a typo is visible in
the output instead of silently deleting text.

---

## Change History

| Date       | Change                                                   | Author |
| ---------- | -------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec (described a module that was never written) | —      |
| 2026-10-02 | Replaced with a pointer to the real substitution path    | —      |
