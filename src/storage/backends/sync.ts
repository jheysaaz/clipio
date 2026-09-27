/**
 * SyncBackend — browser.storage.sync implementation.
 *
 * Primary storage backend. Snippets stored here are automatically synced
 * by the browser across all devices where the user is signed in.
 *
 * Quota limits (Chrome / Firefox / Edge):
 *   Total:          102,400 bytes (100 KB)
 *   Per item:         8,192 bytes  ← binding constraint when using a single key
 *   Max items:          512 keys
 *   Write ops:      1,800 / hour SUSTAINED, 120 / minute BURST
 *
 * Storage layout:
 *   Each snippet is stored under its own key: "snip:<id>"
 *   This lets the total storage grow up to the 100 KB quota instead of
 *   being capped at the 8 KB per-item limit that a single "snippets" key
 *   would impose.
 *
 * Migration:
 *   If the legacy single "snippets" key is detected on first read it is
 *   automatically migrated to the per-key layout and the old key removed.
 */

import type { StorageBackend } from "../types";
import { StorageQuotaError } from "../types";
import type { Snippet } from "@/types";
import { captureError } from "@/lib/sentry";
import { normalizeStoredSnippet } from "../normalize";

const SNIPPET_PREFIX = "snip:";
/** Legacy key used before the per-item layout — kept for migration only. */
const LEGACY_KEY = "snippets";
/**
 * Journal key for an in-flight write. Deliberately does NOT start with
 * `snip:`, so it is never mistaken for a snippet and can never be swept up by
 * the removal derivation.
 */
const PENDING_KEY = "_pendingWrite";
/** Prefix for records that failed to parse. Also not `snip:`-prefixed. */
const CORRUPT_PREFIX = "corrupt:";

/**
 * Largest pending payload we will journal.
 *
 * The journal transiently doubles the storage the pending set needs, and sync
 * is capped at 100 KB. A bulk import of hundreds of snippets could therefore
 * push an otherwise-valid write over the limit and raise a *false* quota
 * error, which flips the user to local storage for no good reason. Writes
 * above this size rely on the upsert-before-remove ordering alone; their
 * failure mode is "some new snippets missing", which the user fixes by
 * re-running the import they just performed.
 */
const JOURNAL_MAX_BYTES = 8 * 1024;

type PendingWrite = {
  toSet: Record<string, Snippet>;
  toRemove: string[];
  at: string;
};

function snippetKey(id: string): string {
  return `${SNIPPET_PREFIX}${id}`;
}

function corruptKey(key: string): string {
  return `${CORRUPT_PREFIX}${key}`;
}

function parseSnippet(value: unknown): Snippet | null {
  try {
    const snippet =
      typeof value === "string"
        ? (JSON.parse(value) as Snippet)
        : (value as Snippet);
    if (!snippet || typeof snippet !== "object" || !("id" in snippet)) {
      return null;
    }
    return normalizeStoredSnippet(snippet);
  } catch {
    return null;
  }
}

export class SyncBackend implements StorageBackend {
  /**
   * Complete an interrupted write, if there is one.
   *
   * `browser.storage.sync` has no transaction spanning calls, so a write is
   * made crash-safe by recording its intent first. All three steps are
   * idempotent, so replaying is safe and running it twice changes nothing.
   *
   * Order matters: upserts before removals. Replaying a removal without
   * knowing its replacement landed is the exact catastrophe the journal
   * exists to prevent.
   *
   * Never throws — a failure here must not break the read that triggered it.
   */
  private async replayPendingWrite(): Promise<void> {
    let raw: unknown;
    try {
      const got = await browser.storage.sync.get(PENDING_KEY);
      raw = got[PENDING_KEY];
    } catch (err) {
      captureError(err, { action: "sync.replay.readJournal" });
      return;
    }
    if (raw === undefined) return;

    const pending = raw as PendingWrite;
    if (
      !pending ||
      typeof pending !== "object" ||
      typeof pending.toRemove !== "object" ||
      pending.toRemove === null ||
      typeof pending.toSet !== "object" ||
      pending.toSet === null
    ) {
      // A journal we cannot read is not actionable, but it must not be
      // mistaken for a snippet. Drop it.
      await browser.storage.sync.remove(PENDING_KEY).catch(() => {});
      return;
    }

    try {
      if (Object.keys(pending.toSet).length > 0) {
        await browser.storage.sync.set(pending.toSet);
      }
      if (pending.toRemove.length > 0) {
        await browser.storage.sync.remove(pending.toRemove);
      }
      await browser.storage.sync.remove(PENDING_KEY);
    } catch (err) {
      // Leave the journal in place so the next read tries again.
      captureError(err, { action: "sync.replay.apply" });
    }
  }

  /**
   * Move an unparseable record out of the `snip:` namespace, preserving it.
   *
   * Previously a parse failure simply skipped the key. The next save derives
   * its removals as "every snip: key not in the incoming list", so the record
   * was permanently deleted on the following write — a transient corruption
   * silently promoted to data loss. The quarantine is not `snip:`-prefixed, so
   * it is invisible to the read loop and can never be swept away.
   *
   * Best-effort: if the quarantine write itself fails (typically quota), the
   * original key is left where it is, which is the previous behaviour and no
   * worse.
   */
  private async quarantine(key: string, value: unknown): Promise<void> {
    try {
      await browser.storage.sync.set({ [corruptKey(key)]: value });
      await browser.storage.sync.remove(key);
    } catch (err) {
      captureError(err, { action: "sync.quarantine", key });
    }
  }

  /** Keys currently held in quarantine. For diagnostics and recovery. */
  async listCorruptKeys(): Promise<string[]> {
    const all = await browser.storage.sync.get(null);
    return Object.keys(all).filter((k) => k.startsWith(CORRUPT_PREFIX));
  }

  async getSnippets(): Promise<Snippet[]> {
    // Finish any write that was interrupted, so a read never observes the
    // half-applied state of a previous one.
    await this.replayPendingWrite();

    const all = await browser.storage.sync.get(null);

    // -----------------------------------------------------------------------
    // Migration: old single-key format → per-key format
    // -----------------------------------------------------------------------
    if (all[LEGACY_KEY] !== undefined) {
      try {
        const raw = all[LEGACY_KEY];
        const snippets: Snippet[] =
          typeof raw === "string" ? JSON.parse(raw) : (raw as Snippet[]);
        const normalized = snippets.map(normalizeStoredSnippet);
        // Write to per-key layout then remove the legacy key
        await this.saveSnippets(normalized);
        await browser.storage.sync.remove(LEGACY_KEY);
        return normalized;
      } catch {
        console.error("[Clipio] SyncBackend: migration from legacy key failed");
        captureError(
          new Error("SyncBackend: migration from legacy key failed"),
          { action: "sync.migration" }
        );
      }
    }

    // -----------------------------------------------------------------------
    // Normal read: collect all snip: keys
    // -----------------------------------------------------------------------
    const snippets: Snippet[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(SNIPPET_PREFIX)) continue;
      const snippet = parseSnippet(value);
      if (snippet) {
        snippets.push(snippet);
        continue;
      }
      console.error(
        "[Clipio] SyncBackend: failed to parse snippet at key",
        key
      );
      captureError(
        new Error(`SyncBackend: failed to parse snippet at key ${key}`),
        { action: "sync.parseSnippet" }
      );
      await this.quarantine(key, value);
    }
    return snippets;
  }

  /**
   * Plan a full replacement write without performing it.
   *
   * Split out so the journal decision and the apply step cannot drift apart,
   * and so tests can assert the plan directly.
   */
  private async planWrite(snippets: Snippet[]): Promise<{
    toSet: Record<string, Snippet>;
    toRemove: string[];
    noop: boolean;
  }> {
    const all = await browser.storage.sync.get(null);
    const existingSnipKeys = Object.keys(all).filter((k) =>
      k.startsWith(SNIPPET_PREFIX)
    );
    const incomingKeys = new Set(snippets.map((s) => snippetKey(s.id)));
    const toRemove = existingSnipKeys.filter((k) => !incomingKeys.has(k));

    // Upsert only snippets whose serialised value has changed
    const toSet: Record<string, Snippet> = {};
    if (snippets.length > 0) {
      for (const snippet of snippets) {
        const key = snippetKey(snippet.id);
        const existing = all[key];
        if (
          existing !== undefined &&
          JSON.stringify(existing) === JSON.stringify(snippet)
        ) {
          continue;
        }
        toSet[key] = snippet;
      }
    }
    return {
      toSet,
      toRemove,
      noop: Object.keys(toSet).length === 0 && toRemove.length === 0,
    };
  }

  /** Apply a plan, journalling first when the payload is small enough. */
  private async applyWrite(plan: {
    toSet: Record<string, Snippet>;
    toRemove: string[];
  }): Promise<void> {
    const { toSet, toRemove } = plan;
    const hasSet = Object.keys(toSet).length > 0;
    if (!hasSet && toRemove.length === 0) return; // nothing to do

    // Journal the intent when it is cheap enough to do so without risking a
    // false quota error. See JOURNAL_MAX_BYTES.
    const journalPayload = JSON.stringify(toSet);
    let journalable = journalPayload.length <= JOURNAL_MAX_BYTES;
    if (journalable) {
      try {
        await browser.storage.sync.set({
          [PENDING_KEY]: {
            toSet,
            toRemove,
            at: new Date().toISOString(),
          } satisfies PendingWrite,
        });
      } catch (err) {
        // A journal we cannot write must not block a write that the
        // upsert-before-remove ordering already made safe. Fall through
        // unjournalled and let the payload write itself surface any genuine
        // quota failure.
        journalable = false;
        captureError(err, { action: "sync.journal.write" });
      }
    }

    try {
      // UPSERTS FIRST, THEN REMOVALS.
      //
      // An interruption between the two leaves extra snippets rather than
      // missing ones. Extra snippets are visible to the user and self-heal on
      // the next write; missing ones are indistinguishable from the user having
      // deleted them, and are gone from the IndexedDB backup too.
      if (hasSet) {
        await browser.storage.sync.set(toSet);
      }
      if (toRemove.length > 0) {
        await browser.storage.sync.remove(toRemove);
      }
      if (journalable) {
        await browser.storage.sync.remove(PENDING_KEY);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("QUOTA_BYTES") ||
          error.message.includes("MAX_ITEMS") ||
          error.message.includes("quota"))
      ) {
        // Drop the journal before surfacing: the write did not apply, and a
        // stale journal would replay removals on the next read.
        if (journalable) {
          await browser.storage.sync.remove(PENDING_KEY).catch(() => {});
        }
        throw new StorageQuotaError();
      }
      throw error;
    }
  }

  /**
   * Replace the entire snippet set.
   *
   * This is the "delete everything I did not see" operation, and it is only
   * correct when the caller genuinely means to replace the whole set —
   * import, mode switch, clear. For a single snippet, prefer
   * `upsertSnippets` / `removeSnippetsById`, which cannot clobber a
   * concurrent write from another context.
   */
  async saveSnippets(snippets: Snippet[]): Promise<void> {
    try {
      const plan = await this.planWrite(snippets);
      if (plan.noop) return;
      await this.applyWrite(plan);
    } catch (error) {
      if (error instanceof StorageQuotaError) throw error;
      throw error;
    }
  }

  /**
   * Write exactly these snippets, deleting nothing.
   *
   * A snippet another context created or updated between our read and this
   * write is untouched, which is what makes a single-snippet save safe.
   */
  async upsertSnippets(snippets: Snippet[]): Promise<void> {
    if (snippets.length === 0) return;
    const toSet: Record<string, Snippet> = {};
    for (const snippet of snippets) {
      toSet[snippetKey(snippet.id)] = snippet;
    }
    await this.applyWrite({ toSet, toRemove: [] });
  }

  /**
   * Remove exactly these snippets by id, writing nothing.
   *
   * Removing by name rather than by set difference is what stops a delete in
   * one context from sweeping away a snippet another context just created.
   */
  async removeSnippetsById(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.applyWrite({
      toSet: {},
      toRemove: ids.map(snippetKey),
    });
  }

  async clear(): Promise<void> {
    const all = await browser.storage.sync.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(SNIPPET_PREFIX));
    if (keys.length > 0) {
      await browser.storage.sync.remove(keys);
    }
  }
}
