// spec: specs/content-format-migration.spec.md
//
// Retires the vestigial `contentFormat` flag.
//
// The flag was read on exactly one path and honoured on none: the editor always
// serialised markdown, while the flag was carried forward onto the markdown
// body. Opening and saving an HTML-format snippet therefore corrupted it — the
// second open ran the markdown source through DOMParser as text/html and
// destroyed every line break.
//
// Legacy HTML bodies are converted once, on read, using the same pipeline the
// product already runs on every TextBlaze / Power Text import. Because the
// field is dropped from the normalised result the conversion is naturally
// idempotent and one-time per snippet.

import { htmlToMarkdownPortable } from "./html-to-markdown";

/**
 * Placeholder that preserves an HTML body the conversion could not represent.
 *
 * Renders as escaped literal text on insertion, so the content stays visible
 * and recoverable instead of being injected as markup.
 */
export const RAW_HTML_PREFIX = "{{raw_html:";

/** The legacy flag, still accepted on the import wire. */
export type LegacyContentFormat = "markdown" | "html";

/** A stored snippet as it may exist in a profile written by Clipio 1.x. */
export type LegacySnippet = {
  id: string;
  label: string;
  content: string;
  shortcut: string;
  contentFormat?: LegacyContentFormat | string;
  tags?: string[];
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A snippet with any `contentFormat` key stripped, whatever the key's value.
 * All unknown keys are preserved: a future format field must not be silently
 * dropped by this migration.
 */
export type MigratedSnippet<T> = Omit<T, "contentFormat"> &
  Record<string, unknown>;

/**
 * Convert a legacy snippet in place-free fashion, dropping `contentFormat`.
 *
 * Safe for a snippet that has no `contentFormat`, which is every snippet
 * written since the flag was retired: no work is done and the object is passed
 * through with the key stripped.
 */
export function migrateContentFormat<T extends LegacySnippet>(
  snippet: T
): MigratedSnippet<T> {
  // The unused destructure is the point: it is how the key is stripped.
  const { contentFormat, ...rest } = snippet;

  // Only the legacy "html" value needs conversion. Anything else — including a
  // value this version does not recognise — is left alone rather than guessed
  // at, so an unknown future format is not silently rewritten as markdown.
  if (contentFormat !== "html") {
    return rest as MigratedSnippet<T>;
  }

  const source = snippet.content;
  if (!source || source.trim() === "") {
    return rest as MigratedSnippet<T>;
  }

  let converted: string;
  try {
    converted = htmlToMarkdownPortable(source);
  } catch {
    // The conversion could not run at all. See the note on the guard below:
    // leaving the body untouched is correct, because nothing was lost.
    return rest as MigratedSnippet<T>;
  }

  if (!converted.trim()) {
    // The conversion RAN and produced nothing from a non-empty body. That is
    // total loss, and losing a user's snippet body is the one outcome not
    // acceptable here, so the original is preserved instead of blanked.
    return {
      ...(rest as MigratedSnippet<T>),
      content: RAW_HTML_PREFIX + source + "}}",
    };
  }

  return { ...(rest as MigratedSnippet<T>), content: converted };
}

/**
 * True if the content is a preserved-raw-HTML placeholder rather than
 * ordinary markdown.
 *
 * Exported for the tests and for callers that need to tell the two apart; no
 * UI reads it today, so nothing depends on the shape beyond the prefix.
 */
export function isRawHtmlPlaceholder(content: string): boolean {
  return content.startsWith(RAW_HTML_PREFIX) && content.endsWith("}}");
}
