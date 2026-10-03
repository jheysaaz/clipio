# 0004 — Refuse a sync write that would breach quota

**Status:** accepted · **Date:** 2026-09-27

## Context

`storage.sync` has hard limits that fail **silently**:

| Limit                     | Value      |
| ------------------------- | ---------- |
| total bytes, all items    | 102,400    |
| bytes per item            | 8,192      |
| max items                 | 512        |

The previous behaviour was: attempt the sync write, catch the failure, and **fall
back to `local` storage**. The user's snippet appeared to save. Then, on the next
read, it was not there — and nothing had said so.

## Decision

**Project the write first.** Given the list of snippets, compute whether it fits.
If it does not, refuse the write and tell the user, instead of silently switching
storage modes behind their back.

## Alternatives considered

**Keep the fallback, but notify.** The data is still missing. A notification after
the fact is worse than asking before, because the user has already moved on.

**Increase the quota.** Not ours to set.

## Consequences

A user near the limit is told to delete snippets rather than silently losing work.
This is the whole point of the change.

## Revisit when

Never. Silent data loss is not a tradeoff to revisit.