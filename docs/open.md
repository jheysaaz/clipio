# Open

**A state, not a log.** Items are deleted when they are addressed. This file is
what is wrong *right now*, not a history of everything that ever was.

---

## Known gaps

### Four components have no tests

`ConfirmDialog`, `ImportWizard`, `NewSnippetView`, `SnippetDetailView` — 0%
coverage. They are measured now (previously they were silently missing from the
coverage report entirely), so this is a tracked gap rather than a hidden one.

### Coverage sits at 81% overall

Against an 80% floor, so it passes — but the floor is 80 *for everything*, and
`src/components/` is far below it because of the four above. Raising the floor is
a deliberate act once real tests land.

### The review prompt can only fire once

The alarm is periodic and calls `shouldShowReviewPrompt()`, which requires state
`"pending"` — then writes `"shown"`. Nothing returns the state to `"pending"`, so
the alarm is a no-op after its first tick.

This wastes a periodic wakeup of the service worker indefinitely. Behaviour
(one-shot prompting) is defensible; the perpetual alarm is not. Decision pending.

### Chrome / Firefox store credentials not yet configured

Publishing is blocked on this. Unrelated to the v1.6.0 failure, which died in the
E2E job before `Submit to Stores` ever ran.

---

## Weak spots

### The E2E suite is the slowest thing in the repo

Was 147 tests / ~7 minutes. Cut to ~24 tests covering only what needs a real
browser. If it grows past ~2 minutes again, something moved into it that did not
belong there.

### `src/components/options/` is the least-tested area

The options redesign moved a lot of behaviour into panels that have no unit tests.

---

## Risks

### `storage.sync` quota is small and unforgiving

102 KB total. The preflight check refuses rather than silently downgrading, but a
heavy media user will hit it. See
[0004](decisions/0004-refuse-sync-writes-over-quota.md).