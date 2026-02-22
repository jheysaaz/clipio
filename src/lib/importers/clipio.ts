/**
 * Clipio import parser — supports both formats:
 *  1. Legacy bare array:   [ { id, label, shortcut, content, ... }, ... ]
 *  2. Versioned envelope:  { version: 1, format: "clipio", exportedAt, snippets: [...] }
 */

import type { ParsedSnippet, FormatParser } from "./types";
import type { Snippet } from "~/types";

interface ClipioEnvelope {
  version: number;
  format: "clipio";
  exportedAt?: string;
  snippets: Snippet[];
}

function isValidSnippet(item: unknown): item is Snippet {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as Snippet).id === "string" &&
    typeof (item as Snippet).label === "string" &&
    typeof (item as Snippet).shortcut === "string" &&
    typeof (item as Snippet).content === "string"
  );
}

function snippetToParsed(snippet: Snippet): ParsedSnippet {
  return {
    suggestedId: snippet.id,
    label: snippet.label,
    shortcut: snippet.shortcut,
    content: snippet.content,
    tags: snippet.tags ?? [],
    // Clipio snippets are already in our format — no unsupported placeholders
    unsupportedPlaceholders: [],
  };
}

export const ClipioParser: FormatParser = {
  id: "clipio",
  displayName: "Clipio",
  iconUrl: "/icon/128.png",

  canParse(raw: unknown): boolean {
    if (raw === null || typeof raw !== "object") return false;

    // Versioned envelope
    if (
      !Array.isArray(raw) &&
      (raw as Record<string, unknown>)["format"] === "clipio"
    ) {
      return true;
    }

    // Legacy bare array
    if (Array.isArray(raw)) {
      if (raw.length === 0) return true;
      return isValidSnippet(raw[0]);
    }

    return false;
  },

  parse(raw: unknown): ParsedSnippet[] {
    let snippets: Snippet[];

    if (Array.isArray(raw)) {
      snippets = (raw as unknown[]).filter(isValidSnippet);
    } else {
      const envelope = raw as ClipioEnvelope;
      snippets = (envelope.snippets ?? []).filter(isValidSnippet);
    }

    return snippets.map(snippetToParsed);
  },
};
