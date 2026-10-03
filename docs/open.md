# Open

**A state, not a log.** Items are deleted when they are addressed. This file is
what is wrong _right now_, not a history of everything that ever was.

---

## Known gaps

### Every file is above 80%

All 51 configured files clear 80%; the lowest is `storage/backends/indexeddb.ts`
at 80.8%. Overall: 94.28% statements, 88.21% branches, 92.26% functions, 95.62%
lines — up from a true 81.76% when four components were still at 0%.

The global thresholds were 81/73/76/81, which meant branches and functions sat
below the 80% floor the project claims to enforce. They are now a flat 80%
across all four metrics, which the current measurement clears with room to
spare. Raising them further is deliberate and needs sign-off; lowering them is
never allowed (AGENTS.md).

### The review prompt fires once per install

The state machine is one-way (`pending -> shown -> dismissed | rated`), so the
prompt is offered at most once. That is deliberate — re-prompting someone who
already ignored you is worse than not prompting them.

What was _not_ deliberate was the alarm: it repeated every 6 hours to re-evaluate
a condition that could only ever fail, waking the service worker indefinitely.
Now one-shot. The reasoning is recorded in `REVIEW_CHECK_DELAY_HOURS`.

Re-prompting would need a cooldown and a state reset — a product decision, not a
config change.

### Chrome / Firefox store credentials not yet configured

Publishing is blocked on this. Unrelated to the v1.6.0 failure, which died in the
E2E job before `Submit to Stores` ever ran.

---

## Weak spots

### `src/components/options/` is the least-tested area

The options redesign moved a lot of behaviour into panels that have no unit tests.
They clear 80% on the presentation they share with the tested components, but the
panel-specific logic is reached through the popup e2e rather than directly.

---

## Risks

### `storage.sync` quota is small and unforgiving

102 KB total. The preflight check refuses rather than silently downgrading, but a
heavy media user will hit it. See
[0004](decisions/0004-refuse-sync-writes-over-quota.md).
