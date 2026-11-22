/**
 * Versioned Clipio backup format (v3) and the decisions around it.
 *
 * v3 is not a renamed snippet export. It is an envelope that also carries
 * allowlisted settings and image blobs, and it is always read through a
 * preview before anything is written. v1/v2 exports remain restorable and are
 * migrated in memory here: they carry snippets (and, in v2, images) but no
 * settings.
 *
 * Everything in this file is pure or operates only on the File/Blob API. It
 * does not touch browser.storage, IndexedDB, or React — those belong in
 * src/storage/backup.ts and the backup dialog.
 */

import { strToU8, unzipSync, zipSync } from "fflate";

import { MEDIA_LIMITS } from "@/config/constants";
import { isValidMediaId } from "@/lib/importers/clipio";
import {
  MAX_ZIP_INFLATED_BYTES,
  MAX_MANIFEST_INFLATED_BYTES,
} from "@/lib/importers/clipio";
import { detectConflicts, suggestShortcut } from "@/lib/importers/merge";
import type { ConflictEntry, ParsedSnippet } from "@/lib/importers/types";
import {
  validateImportPayload,
  type SnippetRejection,
} from "@/lib/snippet-schema";
import type { MediaMetadata } from "@/storage/backends/media";
import type { Snippet } from "@/types";

import {
  selectBackupSettings,
  type BackupSettingKey,
  type SettingsSelection,
  type SettingsSkip,
} from "./backup-settings";

export const BACKUP_FORMAT = "clipio-backup";
export const BACKUP_VERSION = 3;
export const BACKUP_MANIFEST_PATH = "backup.json";
const LEGACY_EXPORT_MANIFEST_PATH = "export.json";

/** A v3 backup is stored as a ZIP; the cap matches the v2 import path. */
export const MAX_BACKUP_FILE_BYTES = MAX_ZIP_INFLATED_BYTES;

export type BackupSettings = Partial<Record<BackupSettingKey, unknown>>;

export interface ClipioBackupV3 {
  version: 3;
  format: "clipio-backup";
  exportedAt: string;
  snippets: Snippet[];
  media: MediaMetadata[];
  settings: BackupSettings;
}

export interface BackupRejection {
  index: number;
  id?: string;
  reason: SnippetRejection | "invalid-media";
}

export interface NormalizedBackup {
  document: ClipioBackupV3;
  settings: SettingsSelection;
  sourceVersion: number;
  rejectedSnippets: BackupRejection[];
  rejectedMedia: BackupRejection[];
  warnings: string[];
}

export interface ParsedBackup extends NormalizedBackup {
  mediaBlobs: Map<string, { blob: Blob; meta: MediaMetadata }>;
  missingMediaIds: string[];
}

export interface SettingChange {
  key: string;
  from: unknown;
  to: unknown;
}

export interface BackupConflictEntry extends ConflictEntry {
  /** Stable per-preview key for a select's data-testid. */
  rowKey: string;
}

export interface BackupPreview {
  sourceVersion: number;
  exportedAt: string;
  snippetCount: number;
  newSnippetCount: number;
  conflictCount: number;
  rejectedSnippetCount: number;
  mediaCount: number;
  missingMediaCount: number;
  settingsChanges: SettingChange[];
  settingsSkipped: SettingsSkip[];
  conflicts: BackupConflictEntry[];
}

interface BuildBackupInput {
  snippets: Snippet[];
  media: MediaMetadata[];
  settings: unknown;
  now?: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Backup snippets are already canonical Clipio records, but the conflict and
 * merge helpers work on `ParsedSnippet`s. Converting here — rather than passing
 * a `Snippet` whose `suggestedId` is undefined — is what makes an id collision
 * detectable at all.
 */
export function backupSnippetToParsed(snippet: Snippet): ParsedSnippet {
  return {
    suggestedId: snippet.id,
    label: snippet.label,
    shortcut: snippet.shortcut,
    content: snippet.content,
    tags: snippet.tags ?? [],
    unsupportedPlaceholders: [],
  };
}

export function backupSnippetsToParsed(
  snippets: readonly Snippet[]
): ParsedSnippet[] {
  return snippets.map(backupSnippetToParsed);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isFiniteNonNegative(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

function isValidMediaMetadata(value: unknown): value is MediaMetadata {
  if (!isPlainObject(value)) return false;
  if (!isValidMediaId(value["id"])) return false;
  if (
    typeof value["mimeType"] !== "string" ||
    !(MEDIA_LIMITS.SUPPORTED_TYPES as readonly string[]).includes(
      value["mimeType"]
    )
  ) {
    return false;
  }
  if (
    !isFiniteNonNegative(value["width"]) ||
    !isFiniteNonNegative(value["height"]) ||
    !isFiniteNonNegative(value["size"]) ||
    !isFiniteNonNegative(value["originalSize"]) ||
    !isIsoTimestamp(value["createdAt"])
  ) {
    return false;
  }
  if (value["alt"] !== undefined && typeof value["alt"] !== "string") {
    return false;
  }
  if (
    value["hash"] !== undefined &&
    (typeof value["hash"] !== "string" || !/^[a-f0-9]{64}$/.test(value["hash"]))
  ) {
    return false;
  }
  return true;
}

/** Build a v3 envelope from live data. The caller supplies the current time. */
export function buildBackupDocument({
  snippets,
  media,
  settings,
  now = new Date(),
}: BuildBackupInput): ClipioBackupV3 {
  const selection = selectBackupSettings(settings);
  return {
    version: BACKUP_VERSION,
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    snippets,
    media,
    settings: selection.values,
  };
}

/**
 * Turn an untrusted parsed JSON value into a v3 document.
 *
 * Snippet and media records that fail validation are reported, not silently
 * dropped. A hand-edited backup that loses three snippets must say so in the
 * preview; "restore succeeded" over fewer snippets than the file contained is
 * a much worse failure than refusing those records at the boundary.
 */
export function normalizeBackupEnvelope(
  raw: unknown,
  now: Date = new Date()
): NormalizedBackup {
  const warnings: string[] = [];
  let sourceVersion: number;
  let rawSnippets: unknown;
  let rawMedia: unknown;
  let rawSettings: unknown;

  if (Array.isArray(raw)) {
    sourceVersion = 1;
    rawSnippets = raw;
    rawMedia = [];
    rawSettings = {};
  } else if (isPlainObject(raw)) {
    const format = raw["format"];
    const version = raw["version"];
    if (format === BACKUP_FORMAT) {
      if (version !== BACKUP_VERSION) {
        throw new Error(`Unsupported backup version: ${String(version)}`);
      }
    } else if (format === "clipio") {
      if (version !== 1 && version !== 2) {
        throw new Error(`Unsupported backup version: ${String(version)}`);
      }
    } else {
      throw new Error("Not a Clipio backup or export");
    }
    sourceVersion = version as number;
    rawSnippets = raw["snippets"];
    rawMedia = raw["media"];
    rawSettings = format === BACKUP_FORMAT ? raw["settings"] : {};
  } else {
    throw new Error("Backup manifest must be an object or array");
  }

  if (!Array.isArray(rawSnippets)) {
    throw new Error("Backup snippets must be an array");
  }
  const snippetValidation = validateImportPayload(rawSnippets);

  const media: MediaMetadata[] = [];
  const rejectedMedia: BackupRejection[] = [];
  if (rawMedia !== undefined && !Array.isArray(rawMedia)) {
    throw new Error("Backup media must be an array");
  }
  for (const [index, entry] of (rawMedia ?? []).entries()) {
    if (isValidMediaMetadata(entry)) {
      media.push(entry);
    } else {
      rejectedMedia.push({
        index,
        id: isPlainObject(entry) ? String(entry["id"] ?? "") : "",
        reason: "invalid-media",
      });
    }
  }

  const exportedAt =
    isPlainObject(raw) && isIsoTimestamp(raw["exportedAt"])
      ? raw["exportedAt"]
      : now.toISOString();
  if (isPlainObject(raw) && !isIsoTimestamp(raw["exportedAt"])) {
    warnings.push("invalid-exported-at");
  }

  const settings = selectBackupSettings(rawSettings);
  const document: ClipioBackupV3 = {
    version: BACKUP_VERSION,
    format: BACKUP_FORMAT,
    exportedAt,
    snippets: snippetValidation.accepted,
    media,
    settings: settings.values,
  };

  return {
    document,
    settings,
    sourceVersion,
    rejectedSnippets: snippetValidation.rejected,
    rejectedMedia,
    warnings,
  };
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

/** Create the v3 ZIP: `backup.json` plus `media/<id>.<ext>` blobs. */
export async function buildBackupArchive(
  document: ClipioBackupV3,
  mediaBlobs: Map<string, Blob>
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    [BACKUP_MANIFEST_PATH]: strToU8(JSON.stringify(document, null, 2)),
  };

  for (const meta of document.media) {
    const blob = mediaBlobs.get(meta.id);
    if (!blob) continue;
    files[`media/${meta.id}.${extensionForMimeType(meta.mimeType)}`] =
      new Uint8Array(await blob.arrayBuffer());
  }

  return new Blob([arrayBufferBacked(zipSync(files, { level: 0 }))], {
    type: "application/zip",
  });
}

/** fflate returns ArrayBufferLike views; Blob requires an ArrayBuffer one. */
function arrayBufferBacked(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function isLikelyJson(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 64));
  return head.trimStart().startsWith("{") || head.trimStart().startsWith("[");
}

function readManifest(
  unzipped: Record<string, Uint8Array>,
  fileName: string
): string {
  const bytes =
    unzipped[BACKUP_MANIFEST_PATH] ?? unzipped[LEGACY_EXPORT_MANIFEST_PATH];
  if (!bytes) {
    throw new Error(
      `Invalid backup ZIP: missing backup manifest in ${fileName}`
    );
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Parse a .clipio.zip backup, a legacy v2 export ZIP, or a legacy JSON export.
 *
 * The same inflated-byte budget as ZIP import applies: `unzipSync` materialises
 * the whole archive before we can inspect individual entries.
 */
export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error("Backup file is too large");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let manifest: string;
  let unzipped: Record<string, Uint8Array> | null = null;

  if (isLikelyJson(bytes)) {
    if (isBackupManifestTooLarge(bytes.byteLength)) {
      throw new Error("Backup manifest is too large");
    }
    manifest = new TextDecoder().decode(bytes);
  } else {
    let inflated = 0;
    try {
      unzipped = unzipSync(bytes, {
        filter: (info) => {
          inflated += info.originalSize;
          if (inflated > MAX_ZIP_INFLATED_BYTES) {
            throw new Error("Backup file inflates beyond the allowed limit");
          }
          return true;
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Backup file")) {
        throw error;
      }
      throw new Error("Invalid backup ZIP", { cause: error });
    }
    if (!unzipped) throw new Error("Invalid backup ZIP");
    manifest = readManifest(unzipped, file.name);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest) as unknown;
  } catch {
    throw new Error("Backup manifest is not valid JSON");
  }

  const normalized = normalizeBackupEnvelope(parsed);
  const mediaBlobs = new Map<string, { blob: Blob; meta: MediaMetadata }>();
  const missingMediaIds: string[] = [];

  for (const meta of normalized.document.media) {
    const prefix = `media/${meta.id}.`;
    const entry = unzipped
      ? Object.keys(unzipped).find((key) => key.startsWith(prefix))
      : undefined;
    const data = entry ? unzipped?.[entry] : undefined;
    if (!data) {
      missingMediaIds.push(meta.id);
      continue;
    }
    mediaBlobs.set(meta.id, {
      blob: new Blob([arrayBufferBacked(data)], { type: meta.mimeType }),
      meta,
    });
  }

  return { ...normalized, mediaBlobs, missingMediaIds };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build the dry-run report shown before a restore writes anything.
 *
 * Conflicts use the import wizard's rules (same id or same shortcut) so the
 * two paths cannot disagree about what "a conflict" means. A missing image is
 * surfaced here instead of discovered after snippets point at a blob that was
 * never in the file.
 */
export function buildBackupPreview(
  backup: ParsedBackup,
  existingSnippets: Snippet[],
  currentSettings: Record<string, unknown>
): BackupPreview {
  const conflicts = detectConflicts(
    backupSnippetsToParsed(backup.document.snippets),
    existingSnippets
  ).map((conflict) => ({
    ...conflict,
    rowKey: conflict.incoming.suggestedId,
    renamedShortcut: suggestShortcut(
      conflict.incoming.shortcut,
      existingSnippets
    ),
  }));

  const settingsChanges: SettingChange[] = [];
  for (const [key, value] of Object.entries(backup.document.settings)) {
    if (sameValue(currentSettings[key], value)) continue;
    settingsChanges.push({ key, from: currentSettings[key], to: value });
  }

  return {
    sourceVersion: backup.sourceVersion,
    exportedAt: backup.document.exportedAt,
    snippetCount: backup.document.snippets.length,
    newSnippetCount: backup.document.snippets.length - conflicts.length,
    conflictCount: conflicts.length,
    rejectedSnippetCount:
      backup.rejectedSnippets.length + backup.rejectedMedia.length,
    mediaCount: backup.document.media.length,
    missingMediaCount: backup.missingMediaIds.length,
    settingsChanges,
    settingsSkipped: backup.settings.skipped,
    conflicts,
  };
}

/**
 * Cap the manifest JSON independently of media. A settings object is small by
 * construction, so anything larger is a reason to stop rather than a backup.
 */
export function isBackupManifestTooLarge(bytes: number): boolean {
  return bytes > MAX_MANIFEST_INFLATED_BYTES;
}
