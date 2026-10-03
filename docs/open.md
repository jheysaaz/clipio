# Open

**A state, not a log.** Items are deleted when they are addressed. This file is
what is wrong _right now_, not a history of everything that ever was.

---

## Known gaps

### Every file is above 80%, and the ratchet has not caught up

All 51 configured files clear 80%; the lowest is `storage/backends/indexeddb.ts`
at 80.8%. Overall statements are 94.28%, up from a true 81.76% when four
components were still at 0%.

The global thresholds in `vitest.config.ts` are still the 81/73/76/81 figures
that were honest when those four components dragged the average down. They are a
ratchet, and a ratchet that sits far below the real number is not ratcheting.
Raising them is a deliberate act.

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
