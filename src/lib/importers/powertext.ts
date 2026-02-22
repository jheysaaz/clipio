/**
 * Power Text import parser.
 *
 * Format: flat JSON object { shortcut: expansion }
 * Each key is the shortcut trigger; each value is the expansion text.
 *
 * Conversion rules:
 *  - %clip% / %clipboard% → {{clipboard}}
 *  - %d(momentFormat)     → {{date:id}} via best-effort moment-to-Clipio mapping,
 *                           or kept as-is and flagged as unsupported
 *  - HTML values          → HTML → Plate nodes → Clipio markdown
 *  - Plain text values    → stored verbatim (after placeholder substitution)
 */

import type { ParsedSnippet, FormatParser } from "./types";
import {
  deserializeContent,
  serializeToMarkdown,
} from "~/components/editor/serialization";

// ---------------------------------------------------------------------------
// Placeholder handling
// ---------------------------------------------------------------------------

/** Matches %clip% and %clipboard% (case-insensitive). */
const PT_CLIPBOARD_RE = /%clip(?:board)?%/gi;

/** Matches %d(momentFormat) date placeholders. */
const PT_DATE_RE = /%d\(([^)]+)\)/g;

/**
 * Best-effort mapping of common moment.js format strings to Clipio date IDs.
 * Checked in order; first match wins.
 */
const MOMENT_TO_CLIPIO_DATE: [RegExp, string][] = [
  [/^YYYY-MM-DD$/i, "iso"],
  [/^MM\/DD\/YYYY$/i, "us"],
  [/^DD\/MM\/YYYY$/i, "eu"],
  // Long forms: "MMMM D, YYYY" / "MMMM Do, YYYY" / "MMMM Do YYYY"
  [/MMMM\s+Do?,?\s+YYYY/i, "long"],
  // Short forms: "MMM D" / "MMM DD" / "MMM Do"
  [/MMM\s+Do?(?:\s|$)/i, "short"],
];

function mapMomentFormat(fmt: string): string | null {
  const trimmed = fmt.trim();
  for (const [re, clipioId] of MOMENT_TO_CLIPIO_DATE) {
    if (re.test(trimmed)) return clipioId;
  }
  return null;
}

/**
 * Replace all recognised Power Text placeholders and collect any tokens we
 * couldn't map so the wizard can offer the user choices.
 */
function replacePlaceholders(text: string): {
  result: string;
  unsupported: string[];
} {
  let result = text;
  const unsupported: string[] = [];

  // 1. Clipboard
  result = result.replace(PT_CLIPBOARD_RE, "{{clipboard}}");

  // 2. Date — reset lastIndex before iterating
  const dateRe = new RegExp(PT_DATE_RE.source, "g");
  result = result.replace(dateRe, (match, fmt: string) => {
    const clipioId = mapMomentFormat(fmt);
    if (clipioId) return `{{date:${clipioId}}}`;
    unsupported.push(match);
    return match; // keep literal so the wizard can handle it
  });

  return { result, unsupported };
}

// ---------------------------------------------------------------------------
// HTML detection & processing
// ---------------------------------------------------------------------------

const HTML_TAG_RE = /<[a-z][\s\S]*>/i;

/**
 * If the expansion looks like HTML, convert it to Clipio markdown.
 * Returns null when the value is plain text or conversion fails.
 */
function maybeConvertHtml(raw: string): string | null {
  if (!HTML_TAG_RE.test(raw)) return null;
  try {
    const nodes = deserializeContent(raw);
    return serializeToMarkdown(nodes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parser implementation
// ---------------------------------------------------------------------------

export const PowerTextParser: FormatParser = {
  id: "powertext",
  displayName: "Power Text",
  iconUrl: "/icon/powertext.png",

  canParse(raw: unknown): boolean {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return false;
    const obj = raw as Record<string, unknown>;
    // Must not resemble a Clipio or TextBlaze export
    if ("format" in obj || "version" in obj || "folders" in obj) return false;
    // At least one entry, all values must be strings
    const values = Object.values(obj);
    return values.length > 0 && values.every((v) => typeof v === "string");
  },

  parse(raw: unknown): ParsedSnippet[] {
    const obj = raw as Record<string, string>;
    const results: ParsedSnippet[] = [];

    for (const [shortcut, expansion] of Object.entries(obj)) {
      const trimmedShortcut = shortcut.trim();
      if (!trimmedShortcut || !expansion) continue;

      // Prefer HTML→markdown conversion when the value contains markup
      const htmlConverted = maybeConvertHtml(expansion);
      const rawText = htmlConverted ?? expansion;

      // Substitute known Power Text placeholders
      const { result: content, unsupported } = replacePlaceholders(rawText);

      // Power Text has no separate "label" field — use the shortcut itself
      results.push({
        suggestedId: crypto.randomUUID(),
        label: trimmedShortcut,
        shortcut: trimmedShortcut,
        content,
        tags: ["power_text"],
        unsupportedPlaceholders: [...new Set(unsupported)],
      });
    }

    return results;
  },
};
