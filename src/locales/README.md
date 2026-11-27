# Translation Guidelines

How to write and maintain the English and Spanish strings in Clipio's locale files. Both languages should feel like they were written by the same friendly, careful team: clear, warm and never robotic.

---

## 1. Ground rules

- **Same structure.** Both locale files must have the same keys, in the same order and nesting. Never add, rename or remove a key in only one file.
- **Placeholders are untouchable.** Keep every `$1`, `$2` and `$3`. You may move them to fit the grammar, but never drop, rename or duplicate them.
- **Keep plural forms.** Keys with `1` and `n` variants keep both, and nouns, verbs and articles must agree with the number.
- **Keep comments.** They are written in English in both files. Do not translate or delete them.
- **Match the length.** Stay within roughly 20% of the other language, and keep buttons, labels and tooltips especially short.
- **Do not translate** product and technical names: Clipio, Giphy, GIF, JSON, ZIP, API, IndexedDB, Prism, theme names and keyboard keys (Ctrl, Alt, Enter, ⌘, ⇧).
- **Translate meaning, not words.** Literal translations are usually wrong, especially for errors, tooltips and onboarding.

---

## 2. Tone and voice

Friendly and professional: never stiff, never slangy. Avoid exclamation marks except in short confirmations ("Copied!", "Thank you!").

| Situation                                                                | Voice                                   |
| ------------------------------------------------------------------------ | --------------------------------------- |
| The product reports something (errors, statuses, warnings, descriptions) | Neutral and impersonal. No "we" or "I". |
| The product asks the user to act (instructions, onboarding, forms)       | Direct, addressing the user as "you".   |

| Situation   | English                                                    | Spanish                                                                          |
| ----------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Error       | Couldn't copy to clipboard                                 | No se pudo copiar al portapapeles                                                |
| Status      | Sync stopped because your snippets outgrew the sync limit. | La sincronización se detuvo porque los fragmentos superaron el límite permitido. |
| Instruction | Pick a shortcut                                            | Elige un atajo                                                                   |
| Recovery    | Please try again.                                          | Inténtalo de nuevo.                                                              |

**Error pattern (both languages):** say what could not be done, then what the user can do. Add the retry line only when retrying can help.

---

## 3. English

- **Spelling:** use "-ise" and "-our" forms consistently (behaviour, prioritise, colour, customise, organise, centre, cancelled).
- **No Oxford comma:** "JPEG, PNG, WebP or GIF".
- **Contractions** in friendly messages ("Couldn't", "isn't"); full forms where a firmer tone helps ("Shortcut cannot contain spaces").
- **Errors:** start with "Couldn't" plus the action. Avoid "Failed to…".
- **Sentence case** for new strings ("Add snippet"). Fix older title-cased strings when you touch them.
- **Ellipsis:** use `…` for in-progress states; keep `...` only where the existing string already has it.
- **Quotes:** curly quotes around UI labels inside descriptions (“Local only”).

---

## 4. Spanish

- **Voice:** address the user as **tú**, never _usted_ or _vosotros_. For errors and statuses use impersonal "se" ("No se pudo guardar", "Se encontraron 3 fragmentos"). Avoid "No pudimos…".
- **Punctuation:** always use opening and closing marks (¿Eliminar imagen? ¡Gracias!). Use «guillemets» around UI labels inside descriptions, `Ej.:` for "e.g.", and `p. ej.` inside sentences.
- **Case:** sentence case ("Formato de fecha", not "Formato De Fecha").
- **Agreement:** check gender and number, especially in plural keys and strings with `$1`.
- **Errors:** "No se pudo…" for one item, "No se pudieron…" for several.

**Preferred vocabulary**

| English                                   | Use                    | Avoid      |
| ----------------------------------------- | ---------------------- | ---------- |
| Settings                                  | Configuración          | Ajustes    |
| Add                                       | Agregar                | Añadir     |
| Press (a key)                             | Oprimir                | Pulsar     |
| Enter (type in)                           | Ingresar               | Introducir |
| Click                                     | Hacer clic (no accent) | Pinchar    |
| Rate                                      | Calificar              | Valorar    |
| Remove (from a list) / Delete (permanent) | Quitar / Eliminar      |            |

---

## 5. Glossary

| English                 | Spanish                       |
| ----------------------- | ----------------------------- |
| Snippet                 | Fragmento                     |
| Shortcut                | Atajo                         |
| Library                 | Biblioteca                    |
| Tag                     | Etiqueta                      |
| Placeholder             | Marcador                      |
| Sync / Synced           | Sincronización / Sincronizado |
| Local only              | Solo local                    |
| Backup                  | Copia de seguridad            |
| Overwrite               | Sobrescribir                  |
| Sidebar                 | Barra lateral                 |
| Clipboard               | Portapapeles                  |
| Preview                 | Vista previa                  |
| Blocked sites           | Sitios bloqueados             |
| Content script          | Script de contenido           |
| Debug log               | Registro de depuración        |
| Release (version notes) | Novedades                     |
| Review (store rating)   | Reseña                        |
| Feedback                | Comentarios                   |

New concepts must be added to this table in the same pull request.

---

## 6. Adding a new language

A new language is added only when **both** conditions are met:

1. **A native speaker writes or reviews every string.** This is mandatory. Machine translation, or translation by someone who is not a native speaker, is not accepted, even as a first draft to be fixed later.
2. **There is a genuine need for the language.** For example, a meaningful share of users who ask for it or who cannot comfortably use the extension without it. Curiosity or completeness is not enough, because every new language is a long-term maintenance commitment.

When both are met, open an issue first to explain the need and name the native speaker, then follow the ground rules above and write a short section for the language in this guide (voice, spelling, vocabulary and glossary). Every new string added to the product afterwards must be translated for each supported language in the same pull request.

---

## 7. YAML formatting

- Use **double quotes** when a value contains `: `, starts with a special character (`+`, `*`, `&`, `#`, `?`, `[`, `{`), or mixes placeholders with punctuation.
- Use **single quotes** when the text contains double quotes.
- Indent with two spaces, never tabs. Save as UTF-8.

---

## 8. Review checklist

- [ ] Both locale files have the same keys, in the same order.
- [ ] Every `$1`, `$2` and `$3` is present, and plural keys are correct.
- [ ] No "Failed to…" in English; no "No pudimos…" or _usted_ in Spanish.
- [ ] Spelling, vocabulary and glossary terms are consistent.
- [ ] Lengths are close to the other language.
- [ ] Product and technical names are unchanged.
- [ ] The YAML parses without errors.
