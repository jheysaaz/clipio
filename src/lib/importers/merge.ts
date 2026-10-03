/**
 * Deciding what an imported snippet should become.
 *
 * WHY THIS IS NOT IN THE COMPONENT
 *
 * These five functions were private to ImportWizard.tsx, which put roughly 150
 * lines of pure logic — conflict detection, shortcut suggestion, the merge that
 * applies a resolution — inside a 1184-line React component. Two consequences:
 * they could not be unit tested, and the component could not be rendered in a
 * test without dragging the whole wizard (four parsers, a file drop zone, zip
 * extraction) into scope to reach them.
 *
 * AGENTS.md states the rule this restores: `src/lib/` is pure logic with no DOM
 * and no browser APIs, `src/components/` is thin. Nothing here touches React,
 * storage or the DOM, so it belongs in lib/ next to the types it operates on.
 */

import type { Snippet } from "@/types";
import type {
  ConflictEntry,
  ParsedSnippet,
  UnsupportedPlaceholderAction,
} from "./types";

/**
 * Apply the user's choice for a snippet containing unsupported placeholders.
 *
 * Returns null for "skip", which is the caller's signal to drop the snippet
 * entirely rather than import it in a modified form.
 */
export function applyUnsupportedAction(
  snippet: ParsedSnippet,
  action: UnsupportedPlaceholderAction
): ParsedSnippet | null {
  if (action === "skip") return null;
  if (action === "remove") {
    // Strip any remaining {token} patterns (single-brace) that are NOT our
    // {{...}} ones. The lookbehind/lookahead pair is what keeps our own
    // double-brace placeholders intact.
    const cleaned = snippet.content.replace(/(?<!\{)\{(?!\{)[^}]+\}/g, "");
    return { ...snippet, content: cleaned, unsupportedPlaceholders: [] };
  }
  // "keep" — leave as literal text
  return { ...snippet, unsupportedPlaceholders: [] };
}

/**
 * Find incoming snippets that collide with what is already stored.
 *
 * A collision is either the same id or the same shortcut. Matching on both
 * matters: an import that reuses an id but changes a shortcut would silently
 * produce two snippets the user cannot tell apart, and one that reuses only a
 * shortcut produces two snippets bound to the same trigger.
 *
 * Everything defaults to "skip", which is the safe resolution — nothing
 * overwrites or duplicates until the user says so.
 */
export function detectConflicts(
  incoming: ParsedSnippet[],
  existing: Snippet[]
): ConflictEntry[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const byShortcut = new Map(existing.map((s) => [s.shortcut, s]));
  const entries: ConflictEntry[] = [];

  for (const snippet of incoming) {
    const idMatch = byId.get(snippet.suggestedId);
    const shortcutMatch = byShortcut.get(snippet.shortcut);

    if (!idMatch && !shortcutMatch) continue;

    // Determine conflict type
    let conflictType: ConflictEntry["conflictType"];
    let existing: Snippet;
    if (idMatch && shortcutMatch && idMatch.id === shortcutMatch.id) {
      conflictType = "both";
      existing = idMatch;
    } else if (idMatch) {
      conflictType = "id";
      existing = idMatch;
    } else {
      conflictType = "shortcut";
      existing = shortcutMatch!;
    }

    entries.push({
      incoming: snippet,
      existing,
      conflictType,
      resolution: "skip",
    });
  }

  return entries;
}

/**
 * Find a free shortcut derived from `base`.
 *
 * Appends `_2`, `_3`, … rather than a random suffix so the suggestion is
 * predictable and stable across repeated calls — the user sees the same name
 * every time the same conflict is resolved.
 */
export function suggestShortcut(base: string, existing: Snippet[]): string {
  const taken = new Set(existing.map((s) => s.shortcut));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/**
 * Byte length of the snippets as JSON.
 *
 * Used to warn before writing an import that would exceed the sync quota. It is
 * an estimate — it measures the payload, not the storage overhead — so the
 * caller must treat a near-limit result as a warning, never as a guarantee that
 * the write will succeed.
 */
export function estimateJsonSize(snippets: Snippet[]): number {
  return JSON.stringify(snippets).length;
}

/**
 * Produce the final snippet list from an import and its conflict resolutions.
 *
 * `existing` snippets survive unless a conflict resolved to "overwrite", in
 * which case the stored one is dropped and the incoming one takes its place.
 * Incoming snippets that resolved to "rename" get a fresh id and the renamed
 * shortcut; "skip" drops them.
 */
export function buildFinalSnippets(
  existing: Snippet[],
  incoming: ParsedSnippet[],
  conflicts: ConflictEntry[]
): Snippet[] {
  const conflictByShortcut = new Map(
    conflicts.map((c) => [c.incoming.shortcut, c])
  );
  const conflictById = new Map(
    conflicts.map((c) => [c.incoming.suggestedId, c])
  );

  // IDs of existing snippets to remove (overwritten ones)
  const idsToRemove = new Set<string>();
  for (const c of conflicts) {
    if (c.resolution === "overwrite") {
      idsToRemove.add(c.existing.id);
    }
  }

  const base = existing.filter((s) => !idsToRemove.has(s.id));

  const toAdd: Snippet[] = [];
  const now = new Date().toISOString();

  for (const parsed of incoming) {
    const idConflict = conflictById.get(parsed.suggestedId);
    const shortcutConflict = conflictByShortcut.get(parsed.shortcut);
    const conflict = idConflict ?? shortcutConflict;

    if (conflict) {
      if (conflict.resolution === "skip") continue;
      if (conflict.resolution === "overwrite") {
        // Already removed the existing one above
        toAdd.push({
          id: parsed.suggestedId,
          label: parsed.label,
          shortcut: parsed.shortcut,
          content: parsed.content,
          tags: parsed.tags,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      } else if (conflict.resolution === "rename") {
        const newShortcut = conflict.renamedShortcut ?? parsed.shortcut;
        toAdd.push({
          id: crypto.randomUUID(),
          label: parsed.label,
          shortcut: newShortcut,
          content: parsed.content,
          tags: parsed.tags,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      toAdd.push({
        id: parsed.suggestedId,
        label: parsed.label,
        shortcut: parsed.shortcut,
        content: parsed.content,
        tags: parsed.tags,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return [...base, ...toAdd];
}
