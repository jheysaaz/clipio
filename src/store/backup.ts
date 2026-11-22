/**
 * Backup restore wizard state.
 *
 * The wizard's only job is to get from a file to an informed "yes". The file
 * is parsed and a preview built before any write happens; a confirm action
 * then applies the resolutions the user chose. All decisions that can be
 * tested without React live in lib/backup.ts; this store owns the sequence.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import {
  buildBackupPreview,
  parseBackupFile,
  type BackupPreview,
  type ParsedBackup,
} from "@/lib/backup";
import type { ConflictResolution, ConflictEntry } from "@/lib/importers/types";
import { captureError } from "@/lib/sentry";
import { getSnippets } from "@/storage";
import {
  readBackupSettings,
  restoreBackup,
  type RestoreResult,
} from "@/storage/backup";

export type BackupPhase =
  "idle" | "loading" | "preview" | "restoring" | "done" | "error";

export interface BackupState {
  phase: BackupPhase;
  fileName: string | null;
  errorCode: string | null;
  backup: ParsedBackup | null;
  preview: BackupPreview | null;
  resolutions: Record<string, ConflictResolution>;
  result: RestoreResult | null;
}

export const initialBackupState: BackupState = {
  phase: "idle",
  fileName: null,
  errorCode: null,
  backup: null,
  preview: null,
  resolutions: {},
  result: null,
};

export const backupStore = createStore<BackupState>(initialBackupState);

export function useBackup<T>(selector: (state: BackupState) => T): T {
  return useStore(backupStore, selector);
}

export function resetBackup(): void {
  backupStore.setState(() => ({ ...initialBackupState }));
}

function errorCodeFor(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("too large")) return "file-too-large";
  if (message.includes("Unsupported backup version"))
    return "unsupported-version";
  if (message.includes("not valid JSON")) return "invalid-json";
  if (message.includes("missing backup manifest")) return "missing-manifest";
  return "parse-failed";
}

/** Parse, validate and preview a backup without touching storage. */
export async function prepareBackup(file: File): Promise<void> {
  backupStore.setState(() => ({
    ...initialBackupState,
    phase: "loading",
    fileName: file.name,
  }));

  try {
    const backup = await parseBackupFile(file);
    const [existingSnippets, currentSettings] = await Promise.all([
      getSnippets(),
      readBackupSettings(),
    ]);
    const preview = buildBackupPreview(
      backup,
      existingSnippets,
      currentSettings
    );
    const resolutions: Record<string, ConflictResolution> = {};
    for (const conflict of preview.conflicts) {
      resolutions[conflict.rowKey] = "skip";
    }

    backupStore.setState(() => ({
      ...initialBackupState,
      phase: "preview",
      fileName: file.name,
      backup,
      preview,
      resolutions,
    }));
  } catch (error) {
    captureError(error, { action: "backup.prepare" });
    backupStore.setState(() => ({
      ...initialBackupState,
      phase: "error",
      fileName: file.name,
      errorCode: errorCodeFor(error),
    }));
  }
}

/** Record a user's per-conflict choice before the confirm step. */
export function setBackupConflictResolution(
  rowKey: string,
  resolution: ConflictResolution
): void {
  backupStore.setState((state) => {
    if (!state.preview?.conflicts.some((c) => c.rowKey === rowKey))
      return state;
    return {
      ...state,
      resolutions: { ...state.resolutions, [rowKey]: resolution },
    };
  });
}

/** Apply the confirmed preview. Nothing is written on the preview step. */
export async function confirmBackupRestore(): Promise<void> {
  const { backup, preview, resolutions } = backupStore.state;
  if (!backup || !preview) return;

  backupStore.setState((state) => ({ ...state, phase: "restoring" }));

  const conflicts: ConflictEntry[] = preview.conflicts.map((conflict) => ({
    ...conflict,
    resolution: resolutions[conflict.rowKey] ?? "skip",
  }));

  try {
    const existingSnippets = await getSnippets();
    const result = await restoreBackup(backup, conflicts, existingSnippets);
    backupStore.setState((state) => ({
      ...state,
      phase: "done",
      result,
    }));
  } catch (error) {
    captureError(error, { action: "backup.restore" });
    backupStore.setState((state) => ({
      ...state,
      phase: "error",
      errorCode: "restore-failed",
    }));
  }
}
