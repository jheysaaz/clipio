/**
 * Versioned backup controls.
 *
 * The button deliberately sits next to, rather than replacing, Export: a
 * snippet export is portable and small, while a backup restores settings and
 * images and can overwrite a library. They answer different questions.
 */

import { useRef } from "react";
import { ArchiveRestore, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ConflictResolution } from "@/lib/importers/types";
import { captureError } from "@/lib/sentry";
import { createBackupFile, downloadBackup } from "@/storage/backup";
import {
  confirmBackupRestore,
  prepareBackup,
  resetBackup,
  setBackupConflictResolution,
  useBackup,
  type BackupPhase,
} from "@/store/backup";
import { i18n } from "#i18n";
import { toast } from "sonner";

function errorCopy(code: string | null): string {
  switch (code) {
    case "file-too-large":
      return i18n.t("options.backup.errors.fileTooLarge");
    case "unsupported-version":
      return i18n.t("options.backup.errors.unsupportedVersion");
    case "invalid-json":
      return i18n.t("options.backup.errors.invalidJson");
    case "missing-manifest":
      return i18n.t("options.backup.errors.missingManifest");
    case "restore-failed":
      return i18n.t("options.backup.errors.restoreFailed");
    default:
      return i18n.t("options.backup.errors.parseFailed");
  }
}

function DialogFooter({
  phase,
  onClose,
}: {
  phase: BackupPhase;
  onClose: () => void;
}) {
  if (phase === "preview") {
    return (
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="backup-restore-cancel"
          onClick={onClose}
        >
          {i18n.t("options.backup.cancel")}
        </Button>
        <Button
          size="sm"
          data-testid="backup-restore-confirm"
          onClick={() => void confirmBackupRestore()}
        >
          {i18n.t("options.backup.confirm")}
        </Button>
      </div>
    );
  }

  if (phase === "done" || phase === "error") {
    return (
      <div className="flex justify-end pt-2">
        <Button size="sm" data-testid="backup-dialog-close" onClick={onClose}>
          {i18n.t("options.backup.close")}
        </Button>
      </div>
    );
  }

  return null;
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const phase = useBackup((s) => s.phase);
  const preview = useBackup((s) => s.preview);
  const errorCode = useBackup((s) => s.errorCode);
  const resolutions = useBackup((s) => s.resolutions);
  const result = useBackup((s) => s.result);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-dialog-title"
        data-testid="backup-preview-dialog"
        className="max-h-[min(90vh,640px)] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl"
      >
        <h2
          id="backup-dialog-title"
          className="text-base font-semibold text-foreground"
        >
          {i18n.t(
            phase === "done"
              ? "options.backup.doneTitle"
              : "options.backup.dialogTitle"
          )}
        </h2>

        {(phase === "loading" || phase === "restoring") && (
          <p
            data-testid="backup-busy"
            className="text-sm text-muted-foreground"
          >
            {i18n.t(
              phase === "restoring"
                ? "options.backup.restoring"
                : "options.backup.loading"
            )}
          </p>
        )}

        {phase === "error" && (
          <p
            data-testid="backup-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errorCopy(errorCode)}
          </p>
        )}

        {phase === "preview" && preview && (
          <div className="space-y-4" data-testid="backup-preview-body">
            <p className="text-sm text-muted-foreground">
              {i18n.t("options.backup.previewIntro")}
            </p>

            <dl
              data-testid="backup-summary"
              className="grid grid-cols-2 gap-2 text-sm"
            >
              <dt className="text-muted-foreground">
                {i18n.t("options.backup.summary.source")}
              </dt>
              <dd className="tabular-nums">
                {i18n.t("options.backup.summary.sourceValue", [
                  String(preview.sourceVersion),
                ])}
              </dd>
              <dt className="text-muted-foreground">
                {i18n.t("options.backup.summary.exported")}
              </dt>
              <dd className="tabular-nums">{preview.exportedAt}</dd>
              <dt className="text-muted-foreground">
                {i18n.t("options.backup.summary.snippets")}
              </dt>
              <dd className="tabular-nums">
                {i18n.t("options.backup.summary.snippetValue", [
                  String(preview.snippetCount),
                  String(preview.newSnippetCount),
                ])}
              </dd>
              <dt className="text-muted-foreground">
                {i18n.t("options.backup.summary.conflicts")}
              </dt>
              <dd data-testid="backup-conflict-count" className="tabular-nums">
                {String(preview.conflictCount)}
              </dd>
              <dt className="text-muted-foreground">
                {i18n.t("options.backup.summary.media")}
              </dt>
              <dd className="tabular-nums">
                {i18n.t("options.backup.summary.mediaValue", [
                  String(preview.mediaCount),
                ])}
              </dd>
            </dl>

            {preview.rejectedSnippetCount > 0 && (
              <p
                data-testid="backup-rejected-count"
                className="text-xs text-muted-foreground"
              >
                {i18n.t("options.backup.summary.rejected", [
                  String(preview.rejectedSnippetCount),
                ])}
              </p>
            )}
            {preview.missingMediaCount > 0 && (
              <p
                data-testid="backup-missing-media"
                role="status"
                className="text-xs text-muted-foreground"
              >
                {i18n.t("options.backup.missingMedia", [
                  String(preview.missingMediaCount),
                ])}
              </p>
            )}

            <section
              data-testid="backup-settings-preview"
              className="space-y-1"
            >
              <h3 className="text-sm font-medium">
                {i18n.t("options.backup.settingsTitle")}
              </h3>
              {preview.settingsChanges.length === 0 ? (
                <p
                  data-testid="backup-no-setting-changes"
                  className="text-xs text-muted-foreground"
                >
                  {i18n.t("options.backup.noChanges")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {preview.settingsChanges.map((change) => (
                    <li
                      key={change.key}
                      data-testid="backup-setting-change"
                      className="font-mono text-xs text-foreground"
                    >
                      {change.key}
                    </li>
                  ))}
                </ul>
              )}
              {preview.settingsSkipped.map((skip) => (
                <p
                  key={skip.key}
                  data-testid="backup-settings-skipped"
                  className="text-xs text-muted-foreground"
                >
                  {i18n.t("options.backup.skippedSetting", [
                    skip.key,
                    skip.reason,
                  ])}
                </p>
              ))}
            </section>

            {preview.conflicts.length > 0 && (
              <section data-testid="backup-conflicts" className="space-y-2">
                <h3 className="text-sm font-medium">
                  {i18n.t("options.backup.conflictsTitle")}
                </h3>
                <ul className="space-y-2">
                  {preview.conflicts.map((conflict) => (
                    <li
                      key={conflict.rowKey}
                      data-testid="backup-conflict-row"
                      data-conflict-id={conflict.rowKey}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {i18n.t("options.backup.conflictRow", [
                          conflict.incoming.label,
                          conflict.existing.shortcut,
                        ])}
                      </span>
                      <select
                        data-testid="backup-conflict-resolution"
                        aria-label={i18n.t("options.backup.resolutionLabel")}
                        className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                        value={resolutions[conflict.rowKey] ?? "skip"}
                        onChange={(event) =>
                          setBackupConflictResolution(
                            conflict.rowKey,
                            event.target.value as ConflictResolution
                          )
                        }
                      >
                        <option value="skip">
                          {i18n.t("options.backup.resolutionSkip")}
                        </option>
                        <option value="overwrite">
                          {i18n.t("options.backup.resolutionOverwrite")}
                        </option>
                        <option value="rename">
                          {i18n.t("options.backup.resolutionRename")}
                        </option>
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-2" data-testid="backup-result">
            <p className="text-sm text-foreground">
              {i18n.t("options.backup.doneSummary", [
                String(result.snippetCount),
                String(result.settingsApplied.length),
                String(result.mediaRestored),
              ])}
            </p>
            {result.settingsFailed.length > 0 && (
              <p
                data-testid="backup-result-skipped"
                className="text-xs text-muted-foreground"
              >
                {i18n.t("options.backup.doneSkipped", [
                  String(result.settingsFailed.length),
                ])}
              </p>
            )}
          </div>
        )}

        <DialogFooter phase={phase} onClose={onClose} />
      </div>
    </div>
  );
}

export function BackupManager() {
  const phase = useBackup((s) => s.phase);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);

  const handleCreate = async () => {
    try {
      const { blob, fileName } = await createBackupFile();
      downloadBackup(blob, fileName);
      toast.success(i18n.t("options.backup.created"));
    } catch (error) {
      captureError(error, { action: "backup.create" });
      toast.error(i18n.t("options.backup.failedCreate"));
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void prepareBackup(file);
    // A second restore of the same file must be possible after a cancel.
    event.target.value = "";
  };

  const closeDialog = () => {
    resetBackup();
    restoreButtonRef.current?.focus();
  };

  return (
    <section data-testid="backup-section" className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            {i18n.t("options.backup.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {i18n.t("options.backup.description")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="backup-create"
            onClick={() => void handleCreate()}
            className="h-8"
          >
            <Icon icon={Download} className="mr-1.5" />
            {i18n.t("options.backup.create")}
          </Button>
          <Button
            ref={restoreButtonRef}
            variant="outline"
            size="sm"
            data-testid="backup-restore-open"
            onClick={() => fileInputRef.current?.click()}
            className="h-8"
          >
            <Icon icon={ArchiveRestore} className="mr-1.5" />
            {i18n.t("options.backup.restore")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            className="hidden"
            data-testid="backup-file-input"
            aria-label={i18n.t("options.backup.fileLabel")}
            onChange={handleFile}
          />
        </div>
      </div>

      {phase !== "idle" && <BackupDialog onClose={closeDialog} />}
    </section>
  );
}
