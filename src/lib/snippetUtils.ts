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

// ---------------------------------------------------------------------------
// Shortcut conflict detection
// ---------------------------------------------------------------------------

export type ShortcutConflict =
  | { type: "exact"; conflictingSnippet: Snippet }
  | { type: "prefix"; conflictingSnippet: Snippet };

/**
 * Checks whether `candidate` conflicts with any shortcut in `existingSnippets`.
 *
 * Two shortcuts conflict when:
 *   - **Exact**: they are identical strings.
 *   - **Prefix**: one is a prefix of the other (e.g. "/comp" vs "/compatible"),
 *     which means typing one could expand before the user finishes the other.
 *
 * @param candidate      - The shortcut the user is typing.
 * @param existingSnippets - The current list of saved snippets to check against.
 * @param excludeId      - Optional snippet id to skip (for future edit support).
 * @returns The first conflict found, or `null` if there are none.
 */
export function detectShortcutConflict(
  candidate: string,
  existingSnippets: Snippet[],
  excludeId?: string
): ShortcutConflict | null {
  if (!candidate) return null;

  for (const snippet of existingSnippets) {
    if (excludeId && snippet.id === excludeId) continue;

    const existing = snippet.shortcut;

    if (candidate === existing) {
      return { type: "exact", conflictingSnippet: snippet };
    }

    if (candidate.startsWith(existing) || existing.startsWith(candidate)) {
      return { type: "prefix", conflictingSnippet: snippet };
    }
  }

  return null;
}
