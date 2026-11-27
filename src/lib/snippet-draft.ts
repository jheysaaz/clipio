/**
 * The editable shape of a snippet, and the rules for when it may be committed.
 *
 * Drafts live in their own local-only storage key. This module deliberately has
 * no browser or i18n dependency: it decides *whether* a draft is valid, while the
 * UI decides how to say so and the storage layer decides where to put it.
 */

import type { Snippet, SnippetFormData } from "@/types";
import { detectShortcutConflict, type ShortcutConflict } from "./snippet-utils";
import {
  GIF_PLACEHOLDER_ANCHORED,
  IMAGE_PLACEHOLDER_ANCHORED,
} from "./media-placeholders";

/** The fields the editor can change. Usage and timestamps are not editable. */
export type EditorFields = Pick<
  Snippet,
  "label" | "content" | "shortcut" | "tags"
>;

/** One in-progress edit, keyed by snippet id (including provisional new ids). */
export type EditorDraft = {
  id: string;
  fields: EditorFields;
  /** Revision the edit was made from; kept across every coalesced write. */
  baseRev: number;
  updatedAt: string;
  /** A new snippet has no stored record yet, so its first write is a create. */
  isNew: boolean;
};

export type DraftMap = Record<string, EditorDraft>;

export type DraftProblem =
  | "emptyLabel"
  | "emptyShortcut"
  | "shortcutSpaces"
  | "shortcutConflict"
  | "emptyContent"
  | "malformedMedia";

export type DraftValidation =
  | { ok: true }
  | { ok: false; problem: DraftProblem; conflict?: ShortcutConflict };

export function fieldsFromSnippet(snippet: Snippet): EditorFields {
  return {
    label: snippet.label,
    content: snippet.content,
    shortcut: snippet.shortcut,
    tags: [...(snippet.tags ?? [])],
  };
}

export function fieldsFromForm(form: SnippetFormData): EditorFields {
  return {
    label: form.label,
    content: form.content,
    shortcut: form.shortcut,
    tags: [...(form.tags ?? [])],
  };
}

/**
 * True when the body contains a `{{image:` or `{{gif:` opener that is not a
 * well-formed placeholder. Partial tokens are common mid-drag in the rich
 * editor; keeping them as drafts is fine, but committing them would create a
 * snippet the content script can never expand correctly.
 */
export function hasMalformedMediaPlaceholder(content: string): boolean {
  const openers = /\{\{(?:image|gif):/g;
  for (const match of content.matchAll(openers)) {
    const rest = content.slice(match.index ?? 0);
    const ok =
      rest.match(IMAGE_PLACEHOLDER_ANCHORED) ||
      rest.match(GIF_PLACEHOLDER_ANCHORED);
    if (!ok) return true;
  }
  return false;
}

/**
 * Validate against the *stored* snippets, not the draft map: two unsaved drafts
 * may temporarily share a shortcut, but neither may collide with a saved one.
 */
export function validateEditorFields(
  fields: EditorFields,
  stored: Snippet[],
  excludeId?: string
): DraftValidation {
  if (!fields.label.trim()) return { ok: false, problem: "emptyLabel" };
  if (!fields.shortcut.trim()) return { ok: false, problem: "emptyShortcut" };
  if (/\s/.test(fields.shortcut)) {
    return { ok: false, problem: "shortcutSpaces" };
  }
  const conflict = detectShortcutConflict(fields.shortcut, stored, excludeId);
  if (conflict) {
    return { ok: false, problem: "shortcutConflict", conflict };
  }
  if (!fields.content.trim()) return { ok: false, problem: "emptyContent" };
  if (hasMalformedMediaPlaceholder(fields.content)) {
    return { ok: false, problem: "malformedMedia" };
  }
  return { ok: true };
}

/** Make a provisional draft for a snippet that has not been written yet. */
export function draftFromForm(
  id: string,
  form: SnippetFormData,
  now = new Date().toISOString()
): EditorDraft {
  return {
    id,
    fields: fieldsFromForm(form),
    baseRev: 0,
    updatedAt: now,
    isNew: true,
  };
}

/**
 * The draft a new create session may safely resume.
 *
 * A draft still marked `isNew` whose id is already in the library is not a
 * recovery: its `baseRev: 0` predates the record's first commit, so enqueueing
 * it makes the queue report a conflict with our own write. Ignoring it gives the
 * next create a fresh id instead of silently editing the previous snippet.
 */
export function recoverableCreateDraft(
  drafts: DraftMap | null | undefined,
  stored: readonly Snippet[]
): EditorDraft | null {
  const recovered = Object.values(drafts ?? {}).find((item) => item.isNew);
  if (!recovered) return null;
  return stored.some((item) => item.id === recovered.id) ? null : recovered;
}
