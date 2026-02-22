/**
 * Auto-detect the import format from a parsed JSON object.
 */

import type { FormatId } from "./types";

/**
 * Returns the detected format ID, or null if the format is unrecognised.
 *
 * Detection heuristics (in priority order):
 *  1. Clipio versioned envelope: `{ format: "clipio", version, snippets }`
 *  2. Clipio legacy bare array: array whose first element looks like a Snippet
 *  3. TextBlaze: `{ version: <number>, folders: [...] }`
 *  4. Power Text: flat `{ shortcut: expansion }` object where all values are strings
 */
export function detectFormat(raw: unknown): FormatId | null {
  if (raw === null || typeof raw !== "object") return null;

  // --- Clipio versioned envelope ---
  if (
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>)["format"] === "clipio"
  ) {
    return "clipio";
  }

  // --- Clipio legacy bare array ---
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "clipio"; // empty export is still ours
    const first = raw[0];
    if (
      typeof first === "object" &&
      first !== null &&
      typeof (first as Record<string, unknown>)["id"] === "string" &&
      typeof (first as Record<string, unknown>)["shortcut"] === "string" &&
      typeof (first as Record<string, unknown>)["content"] === "string"
    ) {
      return "clipio";
    }
    return null;
  }

  // --- TextBlaze ---
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj["version"] === "number" &&
    Array.isArray(obj["folders"])
  ) {
    return "textblaze";
  }

  // --- Power Text ---
  // A non-empty flat object whose keys and values are all strings,
  // with no recognised structural fields from other formats.
  if (
    !("format" in obj) &&
    !("version" in obj) &&
    !("folders" in obj) &&
    !("snippets" in obj)
  ) {
    const values = Object.values(obj);
    if (values.length > 0 && values.every((v) => typeof v === "string")) {
      return "powertext";
    }
  }

  return null;
}
