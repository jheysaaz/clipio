/**
 * Pure helper functions for the content script's snippet expansion logic.
 *
 * Extracted from src/entrypoints/content.ts to make them unit-testable
 * without browser APIs or DOM dependencies.
 *
 * All functions in this module are pure — they do not access the DOM,
 * browser APIs, or storage directly.
 *
 * @see specs/content-expansion.spec.md for the behavioral specification.
 */

import { markdownToHtml, markdownToPlainText } from "./markdown";
import { buildGifUrl } from "./giphy";

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe use inside an HTML attribute value (double- or
 * single-quoted).  Prevents attribute-injection and XSS when content from
 * user-controlled sources (e.g. image alt text stored in IDB) is interpolated
 * into a raw HTML string that will later be assigned to `innerHTML`.
 */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentSnippet {
  id: string;
  shortcut: string;
  content: string;
  label: string;
}

export interface SnippetMatch {
  snippet: ContentSnippet;
  startPos: number;
  endPos: number;
}

export interface ShortcutIndex {
  map: Map<string, ContentSnippet>;
  /** Unique shortcut lengths sorted descending (longest first). */
  lengths: number[];
}

export interface ProcessedContent {
  content: string;
  cursorOffset: number | null;
}

// ---------------------------------------------------------------------------
// Shortcut index
// ---------------------------------------------------------------------------

/** Word-boundary pattern: a character is a boundary if it is whitespace or newline. */
const WORD_BOUNDARY_RE = /[\s\n]/;

/**
 * Build an optimized lookup index from a snippets array.
 * The index enables O(k) shortcut matching where k = number of distinct lengths.
 */
export function buildShortcutIndex(snippets: ContentSnippet[]): ShortcutIndex {
  const map = new Map<string, ContentSnippet>();
  const lengthSet = new Set<number>();

  for (const snippet of snippets) {
    map.set(snippet.shortcut, snippet);
    lengthSet.add(snippet.shortcut.length);
  }

  // Sort descending so longer (more specific) shortcuts match first
  const lengths = [...lengthSet].sort((a, b) => b - a);

  return { map, lengths };
}

/**
 * Check whether the text immediately before the cursor position ends with a
 * known shortcut that is preceded by a word boundary (or is at position 0).
 *
 * Returns the match details, or null if no match is found.
 */
export function findSnippetMatch(
  text: string,
  cursorPosition: number,
  index: ShortcutIndex
): SnippetMatch | null {
  if (!text || index.map.size === 0) return null;

  for (const len of index.lengths) {
    if (len > cursorPosition) continue;

    const startPos = cursorPosition - len;
    const candidate = text.substring(startPos, cursorPosition);
    const snippet = index.map.get(candidate);

    if (
      snippet &&
      (startPos === 0 || WORD_BOUNDARY_RE.test(text[startPos - 1]))
    ) {
      return { snippet, startPos, endPos: cursorPosition };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/**
 * Format a date according to a Clipio date format ID.
 * When dateStr is provided, uses that date; otherwise uses today.
 *
 * Supported formats: "iso", "us", "eu", "long", "short"
 * Unknown formats default to "iso".
 */
export function formatDate(format: string, dateStr?: string): string {
  const date = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  switch (format) {
    case "iso":
      return `${year}-${month}-${day}`;
    case "us":
      return `${month}/${day}/${year}`;
    case "eu":
      return `${day}/${month}/${year}`;
    case "long":
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    case "short":
      return date.toLocaleDateString("en-US", {
        year: "2-digit",
        month: "short",
        day: "numeric",
      });
    default:
      return `${year}-${month}-${day}`;
  }
}

// ---------------------------------------------------------------------------
// Placeholder processing
// ---------------------------------------------------------------------------

/**
 * Process a raw Clipio Markdown snippet by substituting all dynamic placeholders
 * and optionally converting to HTML for contenteditable insertion.
 *
 * The `readClipboard` function is injected as a dependency to keep this function
 * pure and testable without DOM access.
 *
 * @param content - Raw Clipio Markdown content from the snippet.
 * @param asHtml - When true, converts output to HTML for contenteditable.
 * @param readClipboard - Function that reads the current clipboard text.
 * @param resolveMedia - Optional: given a media ID, returns `{ src, alt }` (or null to omit).
 * @param resolveGif - Optional: given a Giphy ID, returns the GIF URL (defaults to buildGifUrl).
 * @returns Processed content string and cursor offset (null if no {{cursor}}).
 */
export function processSnippetContent(
  content: string,
  asHtml: boolean,
  readClipboard: () => string,
  resolveMedia?: (id: string) => { src: string; alt?: string | null } | null,
  resolveGif?: (id: string) => string
): ProcessedContent {
  let processedContent = content;
  let cursorOffset: number | null = null;

  // 1. Clipboard placeholder
  if (processedContent.includes("{{clipboard}}")) {
    const clipboardText = readClipboard();
    processedContent = processedContent.replace(
      /\{\{clipboard\}\}/g,
      clipboardText
    );
  }

  // 2. Date placeholders — {{date:format}}
  const dateRegex = /\{\{date:([a-z]+)\}\}/g;
  let dateMatch: RegExpExecArray | null;
  while ((dateMatch = dateRegex.exec(processedContent)) !== null) {
    const fmt = dateMatch[1];
    const formatted = formatDate(fmt);
    processedContent = processedContent.replace(dateMatch[0], formatted);
    dateRegex.lastIndex = 0; // reset after replacement to avoid skipping
  }

  // 3. Datepicker placeholders — {{datepicker:YYYY-MM-DD}}
  const datepickerRegex = /\{\{datepicker:(\d{4}-\d{2}-\d{2})\}\}/g;
  let datepickerMatch: RegExpExecArray | null;
  while ((datepickerMatch = datepickerRegex.exec(processedContent)) !== null) {
    const dateStr = datepickerMatch[1];
    const formatted = formatDate("long", dateStr);
    processedContent = processedContent.replace(datepickerMatch[0], formatted);
    datepickerRegex.lastIndex = 0;
  }

  if (asHtml) {
    // Convert markdown → HTML ({{cursor}} survives escaping intact)
    // markdownToHtml already handles {{gif:id}} → <img src="giphy-url">
    // and {{image:id}} → <img data-clipio-media="id"> (no src yet)
    processedContent = markdownToHtml(processedContent);

    // 4. Image placeholders — inject actual object URL src into <img data-clipio-media="id">
    if (resolveMedia) {
      processedContent = processedContent.replace(
        /<img[^>]*data-clipio-media="([^"]+)"[^>]*>/g,
        (match, id: string) => {
          const resolved = resolveMedia(id);
          if (!resolved) return ""; // omit unresolvable images
          // Preserve the style attribute (may carry width:NNNpx) from markdownToHtml output
          const styleMatch = match.match(/style="([^"]*)"/);
          const style = styleMatch
            ? styleMatch[1]
            : "max-width:100%;height:auto;";
          const altAttr = resolved.alt
            ? ` alt="${escapeHtmlAttr(resolved.alt)}"`
            : "";
          return `<img src="${resolved.src}"${altAttr} style="${style}" />`;
        }
      );
    }

    // Replace first {{cursor}} with a marker element for cursor positioning
    processedContent = processedContent.replace(
      /\{\{cursor\}\}/,
      '<span id="clipio-cursor-marker" data-clipio-cursor="true"></span>'
    );
    // Remove any remaining cursor placeholders
    processedContent = processedContent.replace(/\{\{cursor\}\}/g, "");
    // cursorOffset stays null for HTML mode (cursor is handled via DOM marker)
  } else {
    // Plain text mode

    // 4. Image placeholders → "[image]"
    processedContent = processedContent.replace(
      /\{\{image:[^}]+\}\}/g,
      "[image]"
    );

    // 5. GIF placeholders → Giphy URL
    processedContent = processedContent.replace(
      /\{\{gif:([^}]+)\}\}/g,
      (_match, id: string) => {
        return resolveGif ? resolveGif(id) : buildGifUrl(id);
      }
    );

    // Strip markdown and handle cursor offset
    const cursorMatch = processedContent.match(/\{\{cursor\}\}/);
    if (cursorMatch && cursorMatch.index !== undefined) {
      // Slice processedContent (clipboard/date substitutions already applied)
      // so the index correctly reflects the post-substitution string length.
      const beforeCursor = processedContent.substring(0, cursorMatch.index);
      // Apply the remaining placeholder substitutions to the before-cursor fragment
      let processedBefore = beforeCursor;
      processedBefore = processedBefore.replace(
        /\{\{image:[^}]+\}\}/g,
        "[image]"
      );
      processedBefore = processedBefore.replace(
        /\{\{gif:([^}]+)\}\}/g,
        (_m, id: string) => (resolveGif ? resolveGif(id) : buildGifUrl(id))
      );
      cursorOffset = markdownToPlainText(processedBefore).length;

      // Strip the cursor marker and convert to plain text
      processedContent = processedContent.replace(/\{\{cursor\}\}/, "");
      processedContent = markdownToPlainText(processedContent);
    } else {
      processedContent = markdownToPlainText(processedContent);
    }
  }

  return { content: processedContent, cursorOffset };
}
