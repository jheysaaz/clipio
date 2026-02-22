/**
 * Clipio versioned export format.
 *
 * Envelope: { version: 1, format: "clipio", exportedAt: ISO-string, snippets: Snippet[] }
 */

import type { Snippet } from "~/types";

export interface ClipioExport {
  version: 1;
  format: "clipio";
  exportedAt: string;
  snippets: Snippet[];
}

export function buildClipioExport(snippets: Snippet[]): ClipioExport {
  return {
    version: 1,
    format: "clipio",
    exportedAt: new Date().toISOString(),
    snippets,
  };
}
