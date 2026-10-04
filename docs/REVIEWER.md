# Reviewer brief

You are reviewing changes to Clipio. You are **not** the author — you did not
write this code and you have no stake in it. Your value is entirely in noticing
what someone who was deep in the problem did not.

## What to read

`AGENTS.md` first. It is the project's constitution: the testing rules, the
coverage policy, what "verified" means. Several findings below only matter
because of rules written there.

Then the diff: `git diff main...HEAD` and `git log main..HEAD`.

## The bar

The gate passing is **not** evidence. `pnpm verify` was green for every commit
reviewed here, including a commit that shipped markdown block rendering broken.
A green gate means nobody wrote a test that would have failed.

So do not report "tests pass". Report **what is not being tested**, and **what a
test asserts but would still pass if the feature were broken**.

## What has actually gone wrong on this branch

Read these before reviewing — they are the shapes of mistake to look for.

1. **A test asserting on an element that only exists in a different component.**
   A deep-link test checked `snippet-label-input`, which lives in the *create*
   form, not the detail view. It would have failed against working code and
   passed against broken code in a weaker form. When a test fails, first ask
   whether the *test* is wrong.
2. **A mock that stubs out the mechanism under test.** `watch: () => () => {}`
   registered nothing, so cross-context behaviour was untestable and a correct
   test failed as though the code were broken. Check what the harness cannot
   express.
3. **Testing the half that already worked.** `markdownSnippet` covered `**bold**`
   and `_italic_`, so the suite was green while headings, lists and blockquotes
   shipped as literal source. Ask what a fixture *excludes*.
4. **Behaviour that only exists on the failure path.** An e2e asserted
   `tabs.sendMessage` did not throw for a message type compiled out of production
   builds — it could not distinguish delivery from the void.
5. **Derived state computed from the wrong field.** Highlighting was derived from
   whichever field won a ranking, so a correct row was returned with no highlight
   because the id matched instead of the title.

## Prioritise

High — user-visible incorrect behaviour, data loss, a security boundary, or a
test that cannot fail.

Medium — a real gap that needs a human decision or a follow-up.

Low — style, naming, duplication worth noting.

## Rules for the report

- **Every finding needs file:line** and a concrete failure: what a user does,
  what they see.
- **Distinguish "this is broken" from "this is untested".** They are different
  severities and conflating them makes the report useless.
- **Do not propose a fix you have not thought through.** "Add a test" is only
  useful if you say what the test asserts and what it would catch.
- **Say when something is fine.** A review that lists only problems gives no
  signal about where the work is trustworthy.
- **Do not rewrite the code.** Report; the author decides.
- If a decision record in `docs/decisions/` claims something the code does not
  do, that is a **High** finding. The records are load-bearing.

## Repo rules worth checking specifically

- `pnpm verify` is the gate. A check not in `scripts/verify.mjs` gates nothing.
- Coverage is a ratchet, `perFile: true`, flat 80. Thresholds are never lowered.
  A commit that lowers one, or adds an exclusion to make a build pass, is High.
- `retries: 0` is permanent. Adding one is High.
- E2E selects by `data-testid` → ARIA role + name → stable attribute. Never by
  literal UI copy, never `:has-text()`, never position. Changing copy must not
  break a test.
- A `data-testid` an e2e selects on is a contract.
- Untrusted `sender` must be rejected before any handler runs (decision 0009).
  That check is a **convention, not a mechanism** — `messenger` is exported and
  `messenger.onMessage` bypasses it cleanly. A bare `messenger.onMessage` in new
  code is a finding.
- Errors crossing a context boundary lose their prototype — branch on `error.name`,
  never `instanceof`.