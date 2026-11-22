# Open

**A state, not a log.** Items are deleted when they are addressed. This file is
what is wrong _right now_, not a history of everything that ever was.

---

## Known gaps

### Every file is above 80% — and now that is enforced per file

99 of 99 configured files clear 80% on **all four** metrics. Overall: 96.39%
statements, 91.12% branches, 96.52% functions, 97.47% lines.

This used to be claimed and not be true. The thresholds were a single flat
80/80/80/80 applied to the **aggregate**, so five files sat below 80 on at least
one metric while the gate stayed green — `indexeddb.ts` was at 58.3% branches,
not the 80.8% this file previously reported. The claim was reading the printed
directory rows, which are not what the threshold is computed over.

Now `perFile: true`, so every file is individually gated. That is strictly
stronger than what it replaced, and it was verified rather than assumed: adding
one uncovered function to `lib/giphy.ts` turns the gate red on that file alone
while all 1958 tests still pass — which the old aggregate-only gate could not
have done.

Raising an individual file above 80 is still the right move when its tests earn
it. Lowering anything is not (AGENTS.md).

### The review prompt fires once per install

The state machine is one-way (`pending -> shown -> dismissed | rated`), so the
prompt is offered at most once. That is deliberate — re-prompting someone who
already ignored you is worse than not prompting them.

What was _not_ deliberate was the alarm: it repeated every 6 hours to re-evaluate
a condition that could only ever fail, waking the service worker indefinitely.
Now one-shot. The reasoning is recorded in `REVIEW_CHECK_DELAY_HOURS`.

Re-prompting would need a cooldown and a state reset — a product decision, not a
config change.

### Firefox store credentials not yet configured

`Submit to Stores` no longer treats the stores as one all-or-nothing step. The
workflow checks each store's secrets separately: a complete set is submitted,
an incomplete one is skipped with a notice, and the GitHub release is created
either way with the Chrome, Firefox and sources ZIPs attached. Chrome's four
v2 service-account secrets are configured; Firefox's three are not, so tag
pushes currently publish to Chrome only.

Chrome's four are the v2 service-account set (`CHROME_EXTENSION_ID`,
`CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`,
`CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`). `wxt submit` (publish-extension v6) retired
the v1.1 refresh-token flow on 2026-10-15, so the old client/secret/token secrets
cannot submit an update even if they are still set.

Two tags never got that far. v1.6.0 died on a flaky e2e (`waitForEvent("page")`,
removed later with the old About panel). v1.6.1 died on `upload-artifact`'s
hidden-file default: `.output/` is a hidden directory and v4.4+ excludes hidden
files, so the action reported "No files were found" for a zip that plainly
existed. The release job now passes `include-hidden-files: true`. Both tags were
released retroactively from their own commits; their artifacts were built from
the tag, not from `main`.

---

## Risks

### `storage.sync` quota is small and unforgiving

102 KB total. The preflight check refuses rather than silently downgrading, but a
heavy media user will hit it. See
[0004](decisions/0004-refuse-sync-writes-over-quota.md).
