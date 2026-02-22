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

import type { Snippet } from "~/types";

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

	/** Persist the full snippets array to this backend. */
	saveSnippets(snippets: Snippet[]): Promise<void>;

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
export type StorageMode = "sync" | "local" /* | "cloud" — future */;

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Exposed to the UI so it can show contextual banners / warnings. */
export interface StorageStatus {
	/** Which backend is currently being used. */
	mode: StorageMode;
	/**
	 * True when the extension fell back from sync to local because the
	 * browser.storage.sync quota was exceeded.
	 */
	quotaExceeded: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by SyncBackend when browser.storage.sync quota is exceeded.
 * The manager catches this and transparently switches to LocalBackend.
 */
export class StorageQuotaError extends Error {
	constructor(message = "browser.storage.sync quota exceeded") {
		super(message);
		this.name = "StorageQuotaError";
	}
}
