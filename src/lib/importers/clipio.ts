/**
 * Clipio import parser — supports both formats:
 *  1. Legacy bare array:   [ { id, label, shortcut, content, ... }, ... ]
 *  2. Versioned envelope:  { version: 1, format: "clipio", exportedAt, snippets: [...] }
 *  3. ZIP envelope (v2):   ZIP file containing export.json + media/ blobs
 */

import type { ParsedSnippet, FormatParser } from "./types";
import type { Snippet } from "~/types";
import type { MediaMetadata } from "~/storage/backends/media";
import { unzipSync } from "fflate";

interface ClipioEnvelope {
  version: number;
  format: "clipio";
  exportedAt?: string;
  snippets: Snippet[];
  media?: MediaMetadata[];
}

export interface ClipioZipImportResult {
  snippets: ParsedSnippet[];
  /** Restored media blobs keyed by their ID from the export. */
  mediaBlobs: Map<string, { blob: Blob; meta: MediaMetadata }>;
  /** IDs of media entries referenced in snippets but missing from the ZIP. */
  missingMediaIds: string[];
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

// ---------------------------------------------------------------------------
// ZIP Import
// ---------------------------------------------------------------------------

/**
 * Parse a Clipio v2 ZIP file.
 *
 * Extracts `export.json` and all `media/<id>.<ext>` blobs.
 * Returns parsed snippets, restored media blobs, and a list of missing IDs.
 *
 * Throws if the ZIP is unreadable or `export.json` is malformed.
 */
export async function importClipioZip(
  file: File
): Promise<ClipioZipImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(arrayBuffer));

  const jsonBytes = unzipped["export.json"];
  if (!jsonBytes) {
    throw new Error("Invalid Clipio ZIP: missing export.json");
  }

  const json = new TextDecoder().decode(jsonBytes);
  let envelope: ClipioEnvelope;
  try {
    envelope = JSON.parse(json) as ClipioEnvelope;
  } catch {
    throw new Error("Invalid Clipio ZIP: export.json is not valid JSON");
  }

  if (envelope.format !== "clipio") {
    throw new Error("Invalid Clipio ZIP: export.json is not a Clipio export");
  }

  const snippets = (envelope.snippets ?? []).filter(isValidSnippet);
  const parsedSnippets = snippets.map(snippetToParsed);

  const mediaBlobs = new Map<string, { blob: Blob; meta: MediaMetadata }>();
  const missingMediaIds: string[] = [];

  const mediaMeta = envelope.media ?? [];

  for (const meta of mediaMeta) {
    // Look for a matching file in the media/ directory
    const prefix = `media/${meta.id}.`;
    const entry = Object.keys(unzipped).find((k) => k.startsWith(prefix));

    if (entry) {
      const mimeType = meta.mimeType || guessMimeFromPath(entry);
      const blob = new Blob([unzipped[entry].buffer as ArrayBuffer], {
        type: mimeType,
      });
      mediaBlobs.set(meta.id, { blob, meta });
    } else {
      missingMediaIds.push(meta.id);
    }
  }

  return { snippets: parsedSnippets, mediaBlobs, missingMediaIds };
}

function guessMimeFromPath(path: string): string {
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/png";
}
