/**
 * Pure helper functions for the snippet preview feature.
 *
 * These functions handle fuzzy filtering, position calculation, trigger detection,
 * and content formatting for the preview UI. Extracted from content script for
 * unit testing without browser environment dependencies.
 *
 * spec: specs/snippet-preview.spec.md
 */

import { markdownToPlainText } from "@/lib/markdown";
import { isShortcutBoundary } from "@/lib/content-helpers";
import type { ContentSnippet } from "@/lib/content-helpers";

// Re-export ContentSnippet for testing
export type { ContentSnippet };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewSettings {
  enabled: boolean;
  triggerPrefix: string;
  keyboardShortcut: string;
}

export interface FilteredSnippet {
  snippet: ContentSnippet;
  relevanceScore: number;
  highlightRanges: Array<{
    start: number;
    end: number;
    field: "shortcut" | "label";
  }>;
}

export interface PreviewPosition {
  x: number;
  y: number;
  maxHeight: number;
}

export interface PreviewState {
  isVisible: boolean;
  selectedIndex: number;
  filteredSnippets: FilteredSnippet[];
  triggerText: string;
  triggerStartPos: number;
}

export interface HoverTooltip {
  isVisible: boolean;
  content: string;
  position: { x: number; y: number };
}

export interface TriggerMatch {
  startPos: number;
  endPos: number;
  query: string;
}

// A byte-identical second declaration of PreviewSettings used to sit here.
// TypeScript merges interface declarations, so it compiled — but it was a trap:
// the first edit to one copy would either be silently shadowed or break the
// build depending on which copy was touched, and a reader could not tell there
// was only meant to be one.
// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Performs fuzzy matching on snippet shortcut and label, returning scored and highlighted results.
 * spec: snippet-preview.spec.md#fuzzyMatchSnippets
 */
export function fuzzyMatchSnippets(
  query: string,
  snippets: ContentSnippet[]
): FilteredSnippet[] {
  if (!query || !snippets.length) {
    return [];
  }

  const queryLower = query.toLowerCase();
  const results: FilteredSnippet[] = [];

  for (const snippet of snippets) {
    const shortcutLower = snippet.shortcut.toLowerCase();
    const labelLower = snippet.label.toLowerCase();

    let relevanceScore = 0;
    const highlightRanges: Array<{
      start: number;
      end: number;
      field: "shortcut" | "label";
    }> = [];
    let bestMatchField: "shortcut" | "label" | null = null;

    // Check shortcut matches
    const shortcutMatch = calculateMatch(queryLower, shortcutLower, true);
    if (shortcutMatch.score > relevanceScore) {
      relevanceScore = shortcutMatch.score;
      bestMatchField = "shortcut";
    }

    // Check label matches
    const labelMatch = calculateMatch(queryLower, labelLower, false);
    if (labelMatch.score > relevanceScore) {
      relevanceScore = labelMatch.score;
      bestMatchField = "label";
    }

    // Only include highlights from the best matching field
    if (relevanceScore > 0 && bestMatchField) {
      const bestMatch =
        bestMatchField === "shortcut" ? shortcutMatch : labelMatch;
      highlightRanges.push(
        ...bestMatch.ranges.map((range) => ({
          ...range,
          field: bestMatchField!,
        }))
      );

      results.push({
        snippet,
        relevanceScore,
        highlightRanges,
      });
    }
  }

  // Sort by relevance score (descending), then by original order
  return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Calculates match score and highlight ranges for query in target text.
 * Returns higher scores for exact prefix matches and consecutive characters.
 */
function calculateMatch(
  query: string,
  target: string,
  isShortcut: boolean
): { score: number; ranges: Array<{ start: number; end: number }> } {
  if (!query || !target) return { score: 0, ranges: [] };

  // Exact prefix match gets highest score
  if (target.startsWith(query)) {
    return {
      score: isShortcut ? 1000 : 800,
      ranges: [{ start: 0, end: query.length }],
    };
  }

  // Fuzzy match - find all matching characters
  const ranges: Array<{ start: number; end: number }> = [];
  let targetIndex = 0;
  let consecutiveBonus = 0;
  let matchedChars = 0;

  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    const foundIndex = target.indexOf(char, targetIndex);

    if (foundIndex === -1) {
      return { score: 0, ranges: [] }; // No match
    }

    // Track character matches for scoring
    matchedChars++;

    // Consecutive character bonus
    if (foundIndex === targetIndex) {
      consecutiveBonus += 50;
    }

    ranges.push({ start: foundIndex, end: foundIndex + 1 });
    targetIndex = foundIndex + 1;
  }

  // Base fuzzy score with length bonus
  const lengthRatio = query.length / target.length;
  const baseScore = isShortcut
    ? 500 + lengthRatio * 100
    : 300 + lengthRatio * 100;

  return {
    score: baseScore + consecutiveBonus + matchedChars * 10,
    ranges: mergeRanges(ranges),
  };
}

/**
 * Merges overlapping or adjacent highlight ranges.
 */
function mergeRanges(
  ranges: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (ranges.length <= 1) return ranges;

  const sorted = ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end + 1) {
      // Overlapping or adjacent ranges - merge them
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Position calculation
// ---------------------------------------------------------------------------

/**
 * Calculates optimal position for the preview popup relative to cursor or target element.
 *
 * `cursorPos` is the caret offset for input/textarea. Without it there is nothing to
 * measure, and the palette falls back to the element's own bounds — which is why every
 * caller must pass it. spec: specs/preview-anchor.spec.md
 */
export function calculatePreviewPosition(
  targetElement: HTMLElement,
  cursorPos?: number
): PreviewPosition {
  try {
    const isInput =
      targetElement instanceof HTMLInputElement ||
      targetElement instanceof HTMLTextAreaElement;
    const isContentEditable = targetElement.isContentEditable;

    if (!isInput && !isContentEditable) {
      return { x: 10, y: 10, maxHeight: 300 }; // Safe fallback
    }

    let cursorCoords: { x: number; y: number };

    if (isInput && typeof cursorPos === "number") {
      cursorCoords = getCursorCoordsInInput(
        targetElement as HTMLInputElement | HTMLTextAreaElement,
        cursorPos
      );
    } else if (isContentEditable) {
      cursorCoords = getCursorCoordsInContentEditable();
    } else {
      // Fallback to element bounds
      const rect = targetElement.getBoundingClientRect();
      cursorCoords = { x: rect.left, y: rect.bottom };
    }

    // Calculate available space
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - cursorCoords.y;
    const spaceAbove = cursorCoords.y;

    // Positioning logic
    let finalY: number;
    let maxHeight: number;

    if (spaceBelow >= 200) {
      // Position below cursor
      finalY = cursorCoords.y + 5;
      maxHeight = spaceBelow - 25;
    } else if (spaceAbove >= 200) {
      // Position above cursor
      maxHeight = spaceAbove - 25;
      finalY = cursorCoords.y - maxHeight - 5;
    } else {
      // Use available space, prefer below
      if (spaceBelow >= spaceAbove) {
        finalY = cursorCoords.y + 5;
        maxHeight = spaceBelow - 25;
      } else {
        maxHeight = spaceAbove - 25;
        finalY = cursorCoords.y - maxHeight - 5;
      }
    }

    // Clamp horizontal position to viewport
    const margin = 10;
    const finalX = Math.max(
      margin,
      Math.min(cursorCoords.x, viewportWidth - 300 - margin)
    );

    return {
      x: finalX,
      y: finalY,
      maxHeight: Math.max(100, maxHeight),
    };
  } catch {
    // Fallback for any errors
    return { x: 10, y: 10, maxHeight: 300 };
  }
}

/**
 * Gets cursor coordinates in input/textarea using mirror element technique.
 *
 * A hidden div reproduces the control's content box and the same text up to the
 * caret; the position of a marker span appended after that text is the caret's
 * position within the control.
 *
 * spec: specs/preview-anchor.spec.md#getCursorCoordsInInput
 */
function getCursorCoordsInInput(
  element: HTMLInputElement | HTMLTextAreaElement,
  cursorPos: number
): { x: number; y: number } {
  const elementRect = element.getBoundingClientRect();
  const value = element.value ?? "";

  if (typeof document === "undefined" || !document.body) {
    return {
      x: elementRect.left + cursorPos * 8, // Approximate character width
      y: elementRect.bottom,
    };
  }

  // Create mirror element to measure text
  const mirror = document.createElement("div");
  const style = window.getComputedStyle(element);

  // Copy relevant styles. Every property here changes glyph advance or line
  // breaking, so any omission shows up as a caret that drifts off to the right
  // or wraps on a different column than the real control.
  const css = mirror.style;
  css.position = "absolute";
  css.visibility = "hidden";
  // Laid out at the viewport origin: only the caret-minus-mirror delta is used,
  // so the mirror's own location is irrelevant.
  css.top = "0";
  css.left = "0";
  css.whiteSpace = "pre-wrap";
  css.wordWrap = "break-word";
  css.overflowWrap = "break-word";
  css.boxSizing = "border-box";
  css.fontFamily = style.fontFamily;
  css.fontSize = style.fontSize;
  css.fontStyle = style.fontStyle;
  css.fontWeight = style.fontWeight;
  css.fontVariant = style.fontVariant;
  css.lineHeight = style.lineHeight;
  css.letterSpacing = style.letterSpacing;
  css.textIndent = style.textIndent;
  css.textTransform = style.textTransform;
  css.tabSize = style.tabSize;
  css.padding = style.padding;
  css.border = style.border;
  // offsetWidth is the control's *border-box* width. Paired with
  // `boxSizing: border-box` and the border/padding copied above, the mirror's
  // content box comes out exactly as wide as the control's, so text wraps on
  // the same columns. The alternatives are both wrong: the computed `width` is a
  // content-box value and would double-count padding and border (mirror wider
  // than the field), and `clientWidth` excludes the border, which with the
  // border copied back would leave the mirror 2 × border too narrow.
  css.width = `${element.offsetWidth}px`;

  mirror.textContent = value.substring(0, cursorPos);
  document.body.appendChild(mirror);

  try {
    // Add cursor marker. Zero-width: a visible glyph sitting exactly at the wrap
    // column would itself wrap to the next line and report the caret a whole
    // line too low.
    const cursorSpan = document.createElement("span");
    cursorSpan.textContent = "\u200b";
    mirror.appendChild(cursorSpan);

    const cursorRect = cursorSpan.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    // The mirror laid out the *whole* value, so the caret's offset inside it has
    // to be corrected by how far the control is scrolled.
    return {
      x:
        elementRect.left +
        (cursorRect.left - mirrorRect.left) -
        (element.scrollLeft || 0),
      y:
        elementRect.top +
        (cursorRect.bottom - mirrorRect.top) -
        (element.scrollTop || 0),
    };
  } finally {
    document.body.removeChild(mirror);
  }
}

/**
 * Gets cursor coordinates in contenteditable using Selection API.
 */
function getCursorCoordsInContentEditable(): { x: number; y: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { x: 0, y: 0 };
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  return {
    x: rect.left,
    y: rect.bottom,
  };
}

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

/**
 * Detects if the text before cursor should trigger the preview (prefix-based triggering).
 * spec: snippet-preview.spec.md#detectPreviewTrigger
 */
export function detectPreviewTrigger(
  text: string,
  cursorPos: number,
  settings: PreviewSettings
): TriggerMatch | null {
  if (!settings.enabled || cursorPos <= 0 || !text) {
    return null;
  }

  const prefix = settings.triggerPrefix;
  if (!prefix) {
    // Empty prefix means always trigger when enabled
    return {
      startPos: 0,
      endPos: cursorPos,
      query: text.substring(0, cursorPos),
    };
  }

  // Find the rightmost occurrence of prefix before cursor
  const beforeCursor = text.substring(0, cursorPos);
  const lastPrefixIndex = beforeCursor.lastIndexOf(prefix);

  if (lastPrefixIndex === -1) {
    return null; // No prefix found
  }

  // Check the boundary before the prefix (unless at start). Shares
  // isShortcutBoundary with findSnippetMatch so expansion and preview can never
  // disagree about where a trigger may begin.
  // spec: specs/shortcut-boundary.spec.md
  if (lastPrefixIndex > 0) {
    if (!isShortcutBoundary(text[lastPrefixIndex - 1])) {
      return null;
    }
  }

  // Extract query after prefix
  const queryStart = lastPrefixIndex + prefix.length;
  const query = text.substring(queryStart, cursorPos);

  return {
    startPos: lastPrefixIndex,
    endPos: cursorPos,
    query,
  };
}

// ---------------------------------------------------------------------------
// Content formatting
// ---------------------------------------------------------------------------

/**
 * Formats snippet content for hover tooltip display (first ~100 characters).
 * spec: snippet-preview.spec.md#createPreviewTooltip
 */
export function createPreviewTooltip(content: string): string {
  if (!content || !content.trim()) {
    return "(empty snippet)";
  }

  try {
    // Convert markdown to plain text
    let plainText = markdownToPlainText(content);

    // Remove placeholder tokens
    plainText = plainText.replace(/\{\{[^}]+\}\}/g, "");

    // Normalize whitespace
    plainText = plainText.replace(/\s+/g, " ").trim();

    if (!plainText) {
      return "(empty snippet)";
    }

    // Truncate at word boundary near 100 characters
    if (plainText.length <= 100) {
      return plainText;
    }

    // Find last space before or at position 100
    let truncatePos = 100;
    while (truncatePos > 50 && plainText[truncatePos] !== " ") {
      truncatePos--;
    }

    // If no space found in reasonable range, truncate at character boundary
    if (truncatePos <= 50) {
      truncatePos = 97; // Leave room for "..."
    }

    return plainText.substring(0, truncatePos) + "...";
  } catch {
    return "(content preview unavailable)";
  }
}
