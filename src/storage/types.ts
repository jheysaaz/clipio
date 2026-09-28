/**
 * Storage abstraction layer for Clipio.
 *
 * The architecture is designed to support multiple backends transparently:
 *   - SyncBackend   (browser.storage.sync)  — current primary
 *   - LocalBackend  (browser.storage.local) — automatic fallback
 *   - CloudBackend  (future)                — opt-in premium tier
 *
 * All backends implement the StorageBackend interface below.
 */

import type { Snippet } from "@/types";
import type { QuotaBreach } from "./quota-preflight";

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

/**
 * Every storage backend must implement this interface.
 * The manager delegates to the active backend through this contract.
 */
export interface StorageBackend {
  /** Return all snippets from this backend. */
  getSnippets(): Promise<Snippet[]>;

  /**
   * Replace the entire snippet set.
   *
   * This is the "delete everything I did not see" operation, and it is only
   * correct when the caller genuinely means to replace the whole set — import,
   * mode switch, clear. For a single snippet, use `upsertSnippets` /
   * `removeSnippetsById`, which cannot clobber a concurrent write from another
   * extension context.
   */
  saveSnippets(snippets: Snippet[]): Promise<void>;

  /**
   * Write exactly these snippets, deleting nothing.
   *
   * A snippet another context created or updated between the caller's read and
   * this write is untouched, which is what makes a single-snippet save safe
   * against concurrent editors.
   */
  upsertSnippets?(snippets: Snippet[]): Promise<void>;

  /**
   * Remove exactly these snippets by id, writing nothing.
   *
   * Removing by name rather than by set difference is what stops a delete in
   * one context from sweeping away a snippet another context just created.
   */
  removeSnippetsById?(ids: string[]): Promise<void>;

  /** Erase all data owned by this backend. */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Storage mode
// ---------------------------------------------------------------------------

/**
 * Which backend is currently active.
 * "cloud" is intentionally reserved for a future tier.
 */
export type StorageMode = "sync" | "local"; /* | "cloud" — future */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Exposed to the UI so it can show contextual banners / warnings. */
export interface StorageStatus {
  /** Which backend is currently being used. */
  mode: StorageMode;
  /**
   * True when the extension is in local mode because sync quota was exceeded
   * (auto-fallback). False when the user manually force-switched to local.
   */
  quotaExceeded: boolean;
  /**
   * Why the extension is in local mode.
   * Only meaningful when mode === "local".
   *   "quota"  — quota overflow (auto-fallback)
   *   "manual" — user-initiated force-switch from Developers section
   */
  localReason: "quota" | "manual";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a write to `browser.storage.sync` would exceed its quota.
 *
 * `reasons` is present when the breach was predicted by the preflight
 * (`checkQuota`) rather than discovered from the browser, and names which
 * limit broke and by how much. The UI needs it to say anything more useful
 * than "quota exceeded".
 *
 * spec: specs/storage-quota-preflight.spec.md
 */
export class StorageQuotaError extends Error {
  readonly reasons?: readonly QuotaBreach[];

  constructor(
    message = "browser.storage.sync quota exceeded",
    reasons?: readonly QuotaBreach[]
  ) {
    super(message);
    this.name = "StorageQuotaError";
    if (reasons) this.reasons = reasons;
  }
}
