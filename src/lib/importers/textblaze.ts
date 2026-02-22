/**
 * TextBlaze import parser.
 *
 * Format: { version: number, folders: Array<{ name, snippets: Array<...> }> }
 * Each snippet has: { name, shortcut, type: "text" | "html", text, html }
 *
 * Conversion rules:
 *  - type "text"  → use `text` field; map {cursor} → {{cursor}}, {clipboard} → {{clipboard}}
 *  - type "html"  → strip data-mce-style attrs, map placeholders, then convert HTML → markdown
 *    via deserializeContent() → serializeToMarkdown()
 */

import type { ParsedSnippet, FormatParser } from "./types";
import {
  deserializeContent,
  serializeToMarkdown,
} from "~/components/editor/serialization";

// ---------------------------------------------------------------------------
// Placeholder handling
// ---------------------------------------------------------------------------

/** Known TextBlaze single-brace placeholders that map to Clipio equivalents. */
const TB_SUPPORTED: [RegExp, string][] = [
  [/\{cursor\}/g, "{{cursor}}"],
  [/\{clipboard\}/g, "{{clipboard}}"],
];

/**
 * Pattern matching any remaining {token} placeholders that we don't support.
 * Excludes already-replaced double-brace patterns.
 */
const TB_UNSUPPORTED_RE = /\{([a-z][^}]*)\}/g;

/**
 * Find all unsupported single-brace placeholder tokens in a string.
 * Must be called BEFORE applying the supported replacements.
 */
function findUnsupported(text: string): string[] {
  // Remove supported ones first so they don't appear in the unsupported list
  let cleaned = text;
  for (const [re] of TB_SUPPORTED) {
    cleaned = cleaned.replace(re, "");
  }
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TB_UNSUPPORTED_RE.source, "g");
  while ((m = re.exec(cleaned)) !== null) {
    found.add(m[0]); // e.g. "{formtext:name}"
  }
  return Array.from(found);
}

/** Replace supported TextBlaze placeholders and return the cleaned string. */
function replaceSupportedPlaceholders(text: string): string {
  let result = text;
  for (const [re, replacement] of TB_SUPPORTED) {
    result = result.replace(re, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// HTML processing
// ---------------------------------------------------------------------------

/** Strip data-mce-* attributes from an HTML string (without a full DOM parser). */
function stripMceAttributes(html: string): string {
  return html.replace(/\s+data-mce-[a-z-]+="[^"]*"/g, "");
}

/**
 * Convert a TextBlaze `type:"html"` snippet to Clipio markdown.
 * Returns the markdown string, or null if conversion fails.
 */
function htmlSnippetToMarkdown(html: string): string | null {
  try {
    // 1. Strip TinyMCE artefacts
    let cleaned = stripMceAttributes(html);

    // 2. Decode HTML entities for placeholders that may be inside tags
    //    e.g. &nbsp; → space (DOMParser will handle most; we fix &nbsp; manually)
    cleaned = cleaned.replace(/&nbsp;/g, " ");

    // 3. Map supported placeholders in the raw HTML string
    cleaned = replaceSupportedPlaceholders(cleaned);

    // 4. Parse HTML → Plate nodes → Markdown
    const nodes = deserializeContent(cleaned);
    return serializeToMarkdown(nodes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TextBlaze snippet shape
// ---------------------------------------------------------------------------

interface TBSnippet {
  name?: string;
  shortcut?: string;
  type?: string;
  text?: string;
  html?: string;
}

interface TBFolder {
  name?: string;
  snippets?: TBSnippet[];
}

interface TBExport {
  version: number;
  folders: TBFolder[];
}

// ---------------------------------------------------------------------------
// Parser implementation
// ---------------------------------------------------------------------------

function parseTBSnippet(
  tbSnippet: TBSnippet,
  tags: string[]
): ParsedSnippet | null {
  const label = (tbSnippet.name ?? "").trim();
  const shortcut = (tbSnippet.shortcut ?? "").trim();

  // Skip snippets without a shortcut or label
  if (!shortcut || !label) return null;

  let content = "";
  const unsupportedPlaceholders: string[] = [];

  if (tbSnippet.type === "html" && tbSnippet.html) {
    // Detect unsupported placeholders in raw html BEFORE conversion
    const raw = stripMceAttributes(tbSnippet.html);
    unsupportedPlaceholders.push(...findUnsupported(raw));

    const md = htmlSnippetToMarkdown(tbSnippet.html);
    if (md !== null) {
      content = md;
    } else {
      // Fallback: use text field
      unsupportedPlaceholders.push(...findUnsupported(tbSnippet.text ?? ""));
      content = replaceSupportedPlaceholders(tbSnippet.text ?? "");
    }
  } else {
    // type "text" — or missing type: use text field
    const raw = tbSnippet.text ?? tbSnippet.html ?? "";
    unsupportedPlaceholders.push(...findUnsupported(raw));
    content = replaceSupportedPlaceholders(raw);
  }

  // Apply user-chosen action for unsupported placeholders here:
  // We store them as literal text (the default); the wizard will offer
  // choices later and will mutate content before final import.
  // For "remove" action: caller strips them. For "skip": caller drops snippet.

  return {
    suggestedId: crypto.randomUUID(),
    label,
    shortcut,
    content,
    tags,
    unsupportedPlaceholders: [...new Set(unsupportedPlaceholders)],
  };
}

export const TextBlazeParser: FormatParser = {
  id: "textblaze",
  displayName: "TextBlaze",
  iconUrl: "/icon/textblaze.png",

  canParse(raw: unknown): boolean {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return false;
    const obj = raw as Record<string, unknown>;
    return typeof obj["version"] === "number" && Array.isArray(obj["folders"]);
  },

  parse(raw: unknown): ParsedSnippet[] {
    const tb = raw as TBExport;
    const results: ParsedSnippet[] = [];

    for (const folder of tb.folders ?? []) {
      // Folder name → tag (lower-cased, trimmed) + always add "text_blaze" source tag
      const folderTag = folder.name ? folder.name.trim().toLowerCase() : null;
      const tags: string[] = ["text_blaze", ...(folderTag ? [folderTag] : [])];

      for (const tbSnippet of folder.snippets ?? []) {
        const parsed = parseTBSnippet(tbSnippet, tags);
        if (parsed) results.push(parsed);
      }
    }

    return results;
  },
};
