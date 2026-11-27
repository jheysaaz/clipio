/**
 * Storage-side work for versioned backups.
 *
 * The pure envelope/archive decisions live in src/lib/backup.ts. This module
 * owns the side effects: reading the allowlisted settings from storage.local,
 * collecting snippets and media, downloading the archive, and applying a
 * confirmed restore.
 */

import { buildFinalSnippets } from "@/lib/importers/merge";
import { remapMediaIds } from "@/lib/media-placeholders";
import type { ConflictEntry } from "@/lib/importers/types";
import { captureError } from "@/lib/sentry";
import {
  backupSnippetsToParsed,
  buildBackupArchive,
  buildBackupDocument,
  type ParsedBackup,
} from "@/lib/backup";
import {
  BACKUP_SETTING_KEYS,
  isBackupSettingKey,
  isValidBackupSetting,
  type BackupSettingKey,
  type SettingsSkip,
} from "@/lib/backup-settings";

import { getMedia, listMedia, restoreMediaEntry } from "./backends/media";
import { bulkSaveSnippets, getSnippets } from "./index";

export interface BackupFile {
  blob: Blob;
  fileName: string;
}

export interface RestoreResult {
  snippetCount: number;
  settingsApplied: string[];
  settingsFailed: SettingsSkip[];
  mediaRestored: number;
  mediaFailed: { id: string; error: string }[];
}

/** Read only the allowlisted raw keys. Never pass storage.local wholesale. */
export async function readBackupSettings(): Promise<Record<string, unknown>> {
  const stored = await browser.storage.local.get([...BACKUP_SETTING_KEYS]);
  const values: Record<string, unknown> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    if (stored[key] !== undefined) values[key] = stored[key];
  }
  return values;
}

/** Collect the live library and settings into a v3 archive. */
export async function createBackupFile(): Promise<BackupFile> {
  const [snippets, mediaMetadata, settings] = await Promise.all([
    getSnippets(),
    listMedia(),
    readBackupSettings(),
  ]);

  const mediaBlobs = new Map<string, Blob>();
  for (const meta of mediaMetadata) {
    const entry = await getMedia(meta.id);
    if (entry?.blob) mediaBlobs.set(meta.id, entry.blob);
  }

  const document = buildBackupDocument({
    snippets,
    media: mediaMetadata,
    settings,
  });
  const blob = await buildBackupArchive(document, mediaBlobs);
  const date = document.exportedAt.slice(0, 10);

  return { blob, fileName: `clipio-backup-${date}.clipio.zip` };
}

/** Trigger the browser download. Kept here so components stay about rendering. */
export function downloadBackup(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Apply settings one key at a time.
 *
 * A hand-edited backup may hold one bad value. That must not cost the user the
 * other twenty-four settings — the failure is reported so the restore summary
 * can name the key that was skipped.
 */
export async function applyBackupSettings(
  values: Partial<Record<BackupSettingKey, unknown>>
): Promise<{ applied: string[]; failed: SettingsSkip[] }> {
  const applied: string[] = [];
  const failed: SettingsSkip[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!isBackupSettingKey(key) || !isValidBackupSetting(key, value)) {
      failed.push({ key, reason: "invalid-value" });
      continue;
    }
    try {
      await browser.storage.local.set({ [key]: value });
      applied.push(key);
    } catch (error) {
      captureError(error, { action: "backup.restoreSetting", key });
      failed.push({ key, reason: "write-failed" });
    }
  }

  return { applied, failed };
}

/**
 * Write a confirmed restore.
 *
 * Settings go first because `storageMode` decides where `bulkSaveSnippets`
 * writes. Media failures are collected rather than thrown: a backup with one
 * oversized image should still restore the snippets that reference the others,
 * and the summary says exactly what did not come across.
 */
export async function restoreBackup(
  backup: ParsedBackup,
  conflicts: ConflictEntry[],
  existingSnippets: Parameters<typeof bulkSaveSnippets>[0]
): Promise<RestoreResult> {
  const settings = await applyBackupSettings(backup.settings.values);

  // Restore media before snippets: a same-hash blob may survive under a
  // different id, and the snippets must be written with the surviving ids.
  const mediaFailed: RestoreResult["mediaFailed"] = [];
  const restoredIds = new Map<string, string>();
  let mediaRestored = 0;
  for (const [id, entry] of backup.mediaBlobs) {
    try {
      restoredIds.set(
        id,
        await restoreMediaEntry({ ...entry.meta, blob: entry.blob })
      );
      mediaRestored += 1;
    } catch (error) {
      captureError(error, { action: "backup.restoreMedia", id });
      mediaFailed.push({
        id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  const finalSnippets = buildFinalSnippets(
    existingSnippets,
    backupSnippetsToParsed(backup.document.snippets),
    conflicts
  ).map((snippet) => ({
    ...snippet,
    content: remapMediaIds(snippet.content, restoredIds),
  }));
  await bulkSaveSnippets(finalSnippets);

  return {
    snippetCount: finalSnippets.length,
    settingsApplied: settings.applied,
    settingsFailed: [...backup.settings.skipped, ...settings.failed],
    mediaRestored,
    mediaFailed,
  };
}
