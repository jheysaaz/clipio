/**
 * Pure utility helpers for snippet collections.
 *
 * Extracted here so they can be unit-tested without rendering React components.
 */

import type { Snippet } from "~/types";

/**
 * Returns the snippet that should be auto-selected in the sidebar: the one
 * with the most-recent `updatedAt` timestamp (matching the UI sort order).
 * Returns `null` when the list is empty.
 *
 * The input array is never mutated.
 */
export function selectNewest(list: Snippet[]): Snippet | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
