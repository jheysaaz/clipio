/**
 * Clipio versioned export format.
 *
 * v1: { version: 1, format: "clipio", exportedAt: ISO-string, snippets: Snippet[] }
 *     Emitted as a .json file when no snippets contain embedded images.
 *
 * v2: Same envelope plus a `media` array with image metadata.
 *     Emitted as a .clipio.zip containing:
 *       export.json   – the ClipioExport v2 envelope
 *       media/        – one file per referenced image blob
 */

import { hasImagePlaceholder, extractImageIds } from "@/lib/media-placeholders";
import type { Snippet } from "@/types";
import type { MediaMetadata } from "@/storage/backends/media";
import { strToU8, zipSync } from "fflate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipioExportV1 {
  version: 1;
  format: "clipio";
  exportedAt: string;
  snippets: Snippet[];
}

export interface ClipioExportV2 {
  version: 2;
  format: "clipio";
  exportedAt: string;
  snippets: Snippet[];
  media: MediaMetadata[];
}

export type ClipioExport = ClipioExportV1 | ClipioExportV2;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Build a v1 envelope (no media). */
export function buildClipioExport(snippets: Snippet[]): ClipioExportV1 {
  return {
    version: 1,
    format: "clipio",
    exportedAt: new Date().toISOString(),
    snippets,
  };
}

/** Build a v2 envelope with image metadata. */
export function buildClipioExportV2(
  snippets: Snippet[],
  media: MediaMetadata[]
): ClipioExportV2 {
  return {
    version: 2,
    format: "clipio",
    exportedAt: new Date().toISOString(),
    snippets,
    media,
  };
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if any snippet content contains an {{image:...}} placeholder.
 * spec: specs/media-placeholders.spec.md
 */
export function snippetsContainMedia(snippets: Snippet[]): boolean {
  return snippets.some((s) => hasImagePlaceholder(s.content));
}

/**
 * The set of distinct media IDs referenced across a list of snippets.
 *
 * Named `collectReferencedMediaIds` rather than `extractMediaIds` because the
 * shared parser exports a function of that name taking a single content string.
 * Two exports with one name and different signatures is a trap: an import that
 * picks the wrong one type-checks, and returns the wrong shape.
 *
 * Deduplication is deliberate and stays here. Whether a caller wants unique ids
 * or every occurrence is a real per-callsite decision: the clipboard path must
 * keep two references to the same image apart, because they can carry different
 * widths, while an export manifest wants one entry per blob.
 *
 * spec: specs/media-placeholders.spec.md
 */
export function collectReferencedMediaIds(snippets: Snippet[]): string[] {
  const ids = new Set<string>();
  for (const s of snippets) {
    for (const id of extractImageIds(s.content)) {
      ids.add(id);
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// ZIP creation
// ---------------------------------------------------------------------------

/**
 * Create a ZIP Blob containing:
 *   - `export.json`  — the ClipioExport v2 JSON
 *   - `media/<id>.<ext>`  — one entry per image blob
 *
 * @param exportData  The v2 envelope (with metadata).
 * @param mediaBlobs  Map from media ID -> Blob (the raw image data).
 */
export async function buildClipioZip(
  exportData: ClipioExportV2,
  mediaBlobs: Map<string, Blob>
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};

  // Add the JSON manifest
  const json = JSON.stringify(exportData, null, 2);
  files["export.json"] = strToU8(json);

  // Add each image blob
  for (const meta of exportData.media) {
    const blob = mediaBlobs.get(meta.id);
    if (!blob) continue;
    const arrayBuffer = await blob.arrayBuffer();
    const ext = extForMimeType(meta.mimeType);
    files[`media/${meta.id}.${ext}`] = new Uint8Array(arrayBuffer);
  }

  const zipped = zipSync(files, { level: 0 }); // level 0 = store only (images are already compressed)
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function extForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/png":
    default:
      return "png";
  }
}
