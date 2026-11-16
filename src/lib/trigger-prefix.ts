/**
 * The configured preview trigger prefix, and the draft it prefills.
 *
 * A new snippet's shortcut is prefilled with the character that opens the preview
 * palette, because that is the character a user is about to type to reach the
 * snippet they are creating. When the trigger prefix is configurable — it is,
 * under Expansion → Trigger prefix — a prefilled `/` is wrong for everyone who
 * changed it: the form suggests a shortcut that will not trigger anything.
 *
 * The prefix is read at the moment the form is opened rather than captured when
 * the module loaded, so changing it in Options and then creating a snippet gives
 * the new prefix. A value read once at import time is stale for the life of the
 * popup document, and the popup is short-lived — the user changes the setting,
 * reopens the popup, and still gets the old prefix.
 */

import { snippetPreviewPrefixItem } from "@/storage/items";
import type { SnippetFormData } from "@/types";

/** The shipped default. Mirrors `snippetPreviewPrefixItem`'s own default. */
export const DEFAULT_TRIGGER_PREFIX = "/";

/**
 * Coerce a stored prefix into something a shortcut can be built from.
 *
 * The setting is a free-text field with no validation on write, so what comes
 * back is not guaranteed to be a usable character: it can be absent, blank, or
 * several characters long. Each of those would otherwise produce a draft that is
 * broken in a different way.
 *
 * Blank is the one that needs a decision rather than a pass-through. An empty
 * trigger prefix is a *valid* configuration — `detectPreviewTrigger` reads it as
 * "always trigger" — but a shortcut that starts with nothing is not a shortcut,
 * so a blank setting falls back to the default rather than prefilling an empty
 * field the user cannot tell apart from an untouched one.
 */
export function normaliseTriggerPrefix(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_TRIGGER_PREFIX;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? DEFAULT_TRIGGER_PREFIX : trimmed;
}

/**
 * Read the prefix the user has configured.
 *
 * A failed read falls back to the default: the form must still open. Refusing to
 * prefill would be a worse outcome than prefilling the character that is right
 * for every user who never changed the setting.
 */
export async function readTriggerPrefix(): Promise<string> {
  try {
    return normaliseTriggerPrefix(await snippetPreviewPrefixItem.getValue());
  } catch {
    return DEFAULT_TRIGGER_PREFIX;
  }
}

/** A blank create-form draft whose shortcut is the given prefix. */
export function createSnippetDraft(
  prefix: string,
  content = ""
): SnippetFormData {
  return {
    label: "",
    shortcut: normaliseTriggerPrefix(prefix),
    content,
    tags: [],
  };
}

/**
 * A blank create-form draft prefilled with the configured trigger prefix.
 *
 * The shape of every "start a new snippet" entry point, including a
 * context-menu capture that already has the body text and only needs a shortcut.
 */
export async function blankSnippetDraft(
  content = ""
): Promise<SnippetFormData> {
  return createSnippetDraft(await readTriggerPrefix(), content);
}
