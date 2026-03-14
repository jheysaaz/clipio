/**
 * Debug logging utility for Clipio.
 *
 * ## Performance guarantee
 *
 * When debug mode is disabled (the default), `debugLog()` is a true no-op:
 *   - It checks a module-level boolean that is updated via a storage watch.
 *   - No async work, no storage reads, no allocations, no console output.
 *   - The synchronous early-return happens before any await point.
 *
 * The flag is initialised lazily on first call and kept current via
 * `debugModeItem.watch()`. This means the very first call in a fresh
 * context will do one async storage read, but every subsequent call in
 * the same context is O(1) synchronous.
 *
 * When debug mode is enabled, the function appends a `DebugLogEntry` to
 * `debugLogItem` (a circular buffer capped at MAX_DEBUG_ENTRIES) and also
 * echoes the entry to the browser console via `console.debug`.
 */

import { debugModeItem, debugLogItem } from "~/storage/items";
import type { DebugLogEntry } from "~/storage/items";

/** Maximum number of entries kept in the circular buffer. */
export const MAX_DEBUG_ENTRIES = 100;

// ---------------------------------------------------------------------------
// In-memory flag cache
// ---------------------------------------------------------------------------

/**
 * Tri-state:
 *   null  — not yet initialised (first call will read storage once)
 *   false — debug mode off (fast-path no-op)
 *   true  — debug mode on (log + write)
 */
let _debugEnabled: boolean | null = null;
let _watching = false;

/**
 * Initialise the in-memory flag cache on first use and install a watch
 * listener so the flag stays current without polling.
 */
async function ensureInitialised(): Promise<void> {
  if (_debugEnabled !== null) return; // already initialised

  try {
    _debugEnabled = await debugModeItem.getValue();
  } catch {
    _debugEnabled = false; // storage unavailable — treat as off
    return;
  }

  if (!_watching) {
    _watching = true;
    debugModeItem.watch((newVal: boolean) => {
      _debugEnabled = newVal;
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a debug log entry when debug mode is on.
 *
 * When debug mode is off this returns **synchronously** with zero overhead
 * (after the first call initialises the flag cache).
 *
 * @param context - Which extension context is logging.
 * @param event   - Short event identifier, e.g. "expand:match".
 * @param detail  - Additional data; JSON-stringified if not already a string.
 */
export async function debugLog(
  context: DebugLogEntry["context"],
  event: string,
  detail: Record<string, unknown> | string = {}
): Promise<void> {
  // Initialise the flag cache on first call (one async storage read ever).
  await ensureInitialised();

  // Synchronous fast-path: if debug is off, return immediately.
  if (!_debugEnabled) return;

  const detailStr =
    typeof detail === "string" ? detail : JSON.stringify(detail);

  const entry: DebugLogEntry = {
    ts: Date.now(),
    context,
    event,
    detail: detailStr,
  };

  console.debug(`[Clipio:${context}] ${event}`, detail);

  try {
    const current = await debugLogItem.getValue();
    const next = [...current, entry];
    // Keep only the most recent MAX_DEBUG_ENTRIES entries (drop oldest)
    const trimmed =
      next.length > MAX_DEBUG_ENTRIES
        ? next.slice(next.length - MAX_DEBUG_ENTRIES)
        : next;
    await debugLogItem.setValue(trimmed);
  } catch {
    // Non-critical — log write failures are silently ignored
  }
}

// ---------------------------------------------------------------------------
// Test helper: reset the flag cache between test runs
// ---------------------------------------------------------------------------

/** @internal Only for use in unit tests. */
export function _resetDebugCache(): void {
  _debugEnabled = null;
  _watching = false;
}
