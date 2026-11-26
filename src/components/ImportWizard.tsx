/**
 * ImportWizard — 4-step import wizard for Clipio & TextBlaze snippets.
 *
 * Step 1: Upload file + detect format
 * Step 2: Review unsupported placeholders (skipped if none)
 * Step 3: Resolve conflicts (skipped if none)
 * Step 4: Confirm + quota check + import
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload,
  FileJson,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { detectFormat } from "@/lib/importers/detect";
import { IMPORT_PARSERS, getParser } from "@/lib/importers/registry";
import { importClipioZip } from "@/lib/importers/clipio";
import type {
  FormatId,
  ConflictResolution,
  UnsupportedPlaceholderAction,
} from "@/lib/importers/types";
import { estimateJsonSize } from "@/lib/importers/merge";
import {
  advanceFromPlaceholders,
  advanceFromUpload,
  canAdvanceFromUpload,
  countImported,
  detectedParserLabel,
  initialiseImport,
  importStore,
  previewFinalSnippets,
  resetImport,
  runImport,
  useImport,
  willExceedQuota,
  type WizardStep,
} from "@/store/import";
import { SYNC_QUOTA } from "@/config/constants";
import { captureError, captureMessage } from "@/lib/sentry";
import { i18n } from "#i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportWizardProps {
  onClose: () => void;
  onImportComplete: (count: number) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({
  current,
  labels,
}: {
  current: WizardStep;
  labels: string[];
}) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {labels.map((label, i) => {
        const stepNum = (i + 1) as WizardStep;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <div key={i} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium border transition-colors",
                isDone
                  ? "bg-primary text-primary-foreground border-transparent"
                  : isActive
                    ? "border-primary text-foreground"
                    : "border-border text-muted-foreground"
              )}
            >
              {isDone ? <Icon icon={CheckCircle2} /> : stepNum}
            </div>
            <span
              className={cn(
                "text-xs",
                isActive
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <Icon
                icon={ChevronRight}
                size="sm"
                className="text-muted-foreground/50 mx-0.5"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ImportWizard({
  onClose,
  onImportComplete,
}: ImportWizardProps) {
  const step = useImport((s) => s.step);
  const existingSnippets = useImport((s) => s.existingSnippets);
  const isDragging = useImport((s) => s.isDragging);
  const fileName = useImport((s) => s.fileName);
  const rawJson = useImport((s) => s.rawJson);
  const detectedFormat = useImport((s) => s.detectedFormat);
  const selectedFormat = useImport((s) => s.selectedFormat);
  const parseError = useImport((s) => s.parseError);
  const parsedSnippets = useImport((s) => s.parsedSnippets);
  const unsupportedEntries = useImport((s) => s.unsupportedEntries);
  const conflictEntries = useImport((s) => s.conflictEntries);
  const importing = useImport((s) => s.importing);
  const importDone = useImport((s) => s.importDone);
  const importedCount = useImport((s) => s.importedCount);
  const importError = useImport((s) => s.importError);
  const storageMode = useImport((s) => s.storageMode);
  const isZipImport = useImport((s) => s.isZipImport);
  const zipMediaCount = useImport((s) => s.zipMediaCount);
  const zipMissingMediaWarning = useImport((s) => s.zipMissingMediaWarning);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Two pieces of purely local form state. Kept here rather than in the store
  // because they are not part of the wizard's meaning: which radio button is
  // selected, and what is currently typed into a rename field. Neither survives a
  // step change and neither is read by a decision.
  const [bulkUnsupportedAction, setBulkUnsupportedAction] = useState("");
  const [bulkConflictResolution, setBulkConflictResolution] = useState("");

  // Load the library and storage status on mount. The wizard stays mounted behind
  // the options page's dialog, so `resetImport` on close — not a fresh mount — is
  // what returns it to step 1 for the next import.
  useEffect(() => {
    void initialiseImport();
    return () => resetImport();
  }, []);

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------

  const processFile = useCallback((file: File) => {
    importStore.setState((prev) => ({
      ...prev,
      parseError: null,
      fileName: file.name,
      // A second file replaces the first entirely, including its media. Leaving
      // the old blobs in place would attach one archive's images to another's
      // snippets on confirm.
      isZipImport: false,
      zipMediaCount: 0,
      zipMissingMediaWarning: null,
      zipMediaBlobs: new Map(),
    }));

    // ZIP import path (v2 exports)
    const isZip =
      file.name.endsWith(".zip") || file.name.endsWith(".clipio.zip");
    if (isZip) {
      importStore.setState((prev) => ({ ...prev, isZipImport: true }));

      importClipioZip(file)
        .then((result) => {
          importStore.setState((prev) => ({
            ...prev,
            zipMediaBlobs: result.mediaBlobs,
            zipMediaCount: result.mediaBlobs.size,
            zipMissingMediaWarning:
              result.missingMediaIds.length > 0
                ? i18n.t("importWizard.confirm.missingImagesWarning")
                : null,
            parsedSnippets: result.snippets,
            rawJson: null,
            detectedFormat: "clipio",
            selectedFormat: "clipio",
            parseError: null,
          }));
          if (result.missingMediaIds.length > 0) {
            captureMessage("ZIP import: missing media entries", "warning", {
              missingIds: result.missingMediaIds,
            });
          }
        })
        .catch((e) => {
          captureError(e, { action: "importClipioZip" });
          importStore.setState((prev) => ({
            ...prev,
            parseError:
              e instanceof Error
                ? e.message
                : i18n.t("importWizard.upload.couldNotRead"),
            isZipImport: false,
          }));
        });
      return;
    }

    file
      .text()
      .then((text) => {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          importStore.setState((prev) => ({
            ...prev,
            parseError: i18n.t("importWizard.upload.invalidJson"),
          }));
          return;
        }

        const fmt = detectFormat(json);
        importStore.setState((prev) => ({
          ...prev,
          rawJson: json as Record<string, unknown> | unknown[],
          detectedFormat: fmt,
          selectedFormat: fmt ?? "",
        }));

        if (fmt) tryParse(json, fmt);
      })
      .catch(() =>
        importStore.setState((prev) => ({
          ...prev,
          parseError: i18n.t("importWizard.upload.couldNotRead"),
        }))
      );
  }, []);

  function tryParse(json: unknown, format: FormatId) {
    try {
      const parser = getParser(format);
      // Unreachable from the UI: `format` is a `FormatId` and every one is
      // registered. Guarded anyway so a format added to the union without a
      // parser surfaces as a parse error instead of a TypeError.
      if (!parser)
        throw new Error(`No parser registered for format "${format}"`);
      const snippets = parser.parse(json);
      importStore.setState((prev) => ({
        ...prev,
        parsedSnippets: snippets,
        parseError: null,
      }));
    } catch (e) {
      importStore.setState((prev) => ({
        ...prev,
        parseError:
          e instanceof Error
            ? e.message
            : i18n.t("importWizard.upload.failedToParse"),
        // Cleared, so a failed re-parse cannot leave the previous format's
        // snippets on screen for a format that did not parse.
        parsedSnippets: [],
      }));
    }
  }

  function handleFormatChange(fmt: FormatId) {
    importStore.setState((prev) => ({ ...prev, selectedFormat: fmt }));
    const { rawJson: json } = importStore.state;
    if (json) tryParse(json, fmt);
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      importStore.setState((prev) => ({ ...prev, isDragging: false }));
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  // ---------------------------------------------------------------------------
  // Step navigation
  //
  // The routing itself is in `@/store/import` — which step comes next, what the
  // rows are seeded with, and which snippet list each step is talking about. That
  // is where the decisions that can silently overwrite or mangle a snippet live,
  // and they were unreachable from a test while they lived here.
  // ---------------------------------------------------------------------------

  async function runWizardImport() {
    const count = await runImport();
    if (count !== null) onImportComplete(count);
  }

  // ---------------------------------------------------------------------------
  // Computed values for step 4
  // ---------------------------------------------------------------------------

  const detectedParser = detectedParserLabel(detectedFormat);

  const finalSnippetPreview = previewFinalSnippets(
    existingSnippets,
    parsedSnippets,
    conflictEntries
  );
  const estimatedSize = estimateJsonSize(finalSnippetPreview);
  const quotaPercent = Math.min(
    100,
    Math.round((estimatedSize / SYNC_QUOTA.TOTAL_BYTES) * 100)
  );

  const skippedCount = conflictEntries.filter(
    (c) => c.resolution === "skip"
  ).length;
  const overwrittenCount = conflictEntries.filter(
    (c) => c.resolution === "overwrite"
  ).length;
  const renamedCount = conflictEntries.filter(
    (c) => c.resolution === "rename"
  ).length;

  // One number, from one place. The component computed this twice by different
  // routes — see `countImported` for why that was two answers to maintain rather
  // than a number to fix.
  const quotaWillExceed = willExceedQuota(
    existingSnippets,
    parsedSnippets,
    conflictEntries,
    storageMode
  );

  const snippetsToAdd = countImported(parsedSnippets, conflictEntries);

  const STEP_LABELS = [
    i18n.t("importWizard.steps.upload"),
    i18n.t("importWizard.steps.placeholders"),
    i18n.t("importWizard.steps.conflicts"),
    i18n.t("importWizard.steps.confirm"),
  ];

  // ---------------------------------------------------------------------------
  // Narrow setters for the two remaining places the view writes wizard state
  // directly. A back button, and the per-row editors on steps 2 and 3 — the rows
  // themselves are seeded by the routing, so these only ever adjust what is on
  // screen.
  // ---------------------------------------------------------------------------

  function setStepCompat(
    next: WizardStep | ((s: WizardStep) => WizardStep)
  ): void {
    const resolved =
      typeof next === "function"
        ? (next as (s: WizardStep) => WizardStep)(step)
        : next;
    importStore.setState((p) => ({ ...p, step: resolved }));
  }

  function setUnsupportedEntriesCompat(
    next:
      | typeof unsupportedEntries
      | ((p: typeof unsupportedEntries) => typeof unsupportedEntries)
  ): void {
    importStore.setState((p) => ({
      ...p,
      unsupportedEntries:
        typeof next === "function"
          ? (
              next as (
                x: typeof unsupportedEntries
              ) => typeof unsupportedEntries
            )(p.unsupportedEntries)
          : next,
    }));
  }

  function setConflictEntriesCompat(
    next:
      | typeof conflictEntries
      | ((p: typeof conflictEntries) => typeof conflictEntries)
  ): void {
    importStore.setState((p) => ({
      ...p,
      conflictEntries:
        typeof next === "function"
          ? (next as (x: typeof conflictEntries) => typeof conflictEntries)(
              p.conflictEntries
            )
          : next,
    }));
  }

  /** Step 3 has nothing to resolve on its way out — it only advances. */
  function advanceFromStep3Compat(): void {
    setStepCompat(4);
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const canGoNext1 = canAdvanceFromUpload(importStore.state);

  // ---------------------------------------------------------------------------
  // Step 1 — Upload
  // ---------------------------------------------------------------------------

  const renderStep1 = () => (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
          isDragging
            ? "border-ring bg-accent/50"
            : "border-border hover:border-muted-foreground"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          importStore.setState((p) => ({ ...p, isDragging: true }));
        }}
        onDragLeave={() =>
          importStore.setState((p) => ({ ...p, isDragging: false }))
        }
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.zip,.clipio.zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) processFile(f);
            e.target.value = "";
          }}
        />
        {fileName ? (
          <div className="flex flex-col items-center gap-2">
            <Icon
              icon={FileJson}
              size="3xl"
              className="text-muted-foreground"
            />
            <p className="text-sm font-medium text-foreground">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {i18n.t("importWizard.upload.clickToChange")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Icon icon={Upload} size="3xl" className="text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {i18n.t("importWizard.upload.dropHere")}
            </p>
            <p className="text-xs text-muted-foreground">
              {i18n.t("importWizard.upload.clickToBrowse")}
            </p>
          </div>
        )}
      </div>

      {/* Format detection */}
      {rawJson && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {i18n.t("importWizard.upload.detectedFormat")}
            </p>
            {detectedParser ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                {detectedParser.iconUrl && (
                  <img
                    src={detectedParser.iconUrl}
                    alt=""
                    className="w-3.5 h-3.5 rounded-sm object-contain"
                    onError={(e) =>
                      ((e.target as HTMLImageElement).style.display = "none")
                    }
                  />
                )}
                {detectedParser.displayName}
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                {i18n.t("importWizard.upload.unknownFormat")}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {i18n.t("importWizard.upload.formatLabel")}
            </Label>
            <RadioGroup
              value={selectedFormat}
              onValueChange={(v) => handleFormatChange(v as FormatId)}
              className="flex gap-4"
            >
              {IMPORT_PARSERS.map((parser) => (
                <div key={parser.id} className="flex items-center gap-2">
                  <RadioGroupItem value={parser.id} id={`fmt-${parser.id}`} />
                  <Label
                    htmlFor={`fmt-${parser.id}`}
                    className="text-sm cursor-pointer flex items-center gap-1.5"
                  >
                    {parser.iconUrl && (
                      <img
                        src={parser.iconUrl}
                        alt=""
                        className="w-4 h-4 rounded-sm object-contain shrink-0"
                        onError={(e) =>
                          ((e.target as HTMLImageElement).style.display =
                            "none")
                        }
                      />
                    )}
                    {parser.displayName}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>
      )}

      {/* Parse result */}
      {parseError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <Icon icon={AlertTriangle} className="mt-0.5 shrink-0" />
          {parseError}
        </div>
      )}
      {parsedSnippets.length > 0 && !parseError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border text-xs text-muted-foreground">
          <Icon icon={CheckCircle2} className="text-green-500 shrink-0" />
          {i18n.t("importWizard.upload.foundSnippets", parsedSnippets.length)}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Step 2 — Unsupported Placeholders
  // ---------------------------------------------------------------------------

  const renderStep2 = () => (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {i18n.t("importWizard.placeholders.description")}
      </p>

      {/* Apply to all */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border">
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          {i18n.t("importWizard.placeholders.applyToAll")}
        </span>
        <Select
          value={bulkUnsupportedAction}
          onValueChange={(v) => {
            setUnsupportedEntriesCompat((prev) =>
              prev.map((e) => ({
                ...e,
                action: v as UnsupportedPlaceholderAction,
              }))
            );
            setBulkUnsupportedAction("");
          }}
        >
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue
              placeholder={i18n.t("importWizard.placeholders.chooseAction")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">
              {i18n.t("importWizard.placeholders.keepAsLiteral")}
            </SelectItem>
            <SelectItem value="remove">
              {i18n.t("importWizard.placeholders.removeFromContent")}
            </SelectItem>
            <SelectItem value="skip">
              {i18n.t("importWizard.placeholders.skipSnippet")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="max-h-64 overflow-y-auto -mr-2 pr-2 space-y-2.5">
        {unsupportedEntries.map((entry, idx) => (
          <div
            key={entry.snippet.suggestedId}
            className="p-3 rounded-lg border space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {entry.snippet.label}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {entry.snippet.shortcut}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {entry.snippet.unsupportedPlaceholders.map((p) => (
                  <span
                    key={p}
                    className="text-xs font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Label
                htmlFor={`action-${idx}`}
                className="text-xs text-muted-foreground shrink-0"
              >
                {i18n.t("importWizard.placeholders.actionLabel")}
              </Label>
              <Select
                value={entry.action}
                onValueChange={(v) => {
                  setUnsupportedEntriesCompat((prev) =>
                    prev.map((e, i) =>
                      i === idx
                        ? { ...e, action: v as UnsupportedPlaceholderAction }
                        : e
                    )
                  );
                }}
              >
                <SelectTrigger
                  id={`action-${idx}`}
                  className="h-7 text-xs flex-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">
                    {i18n.t("importWizard.placeholders.keepAsLiteral")}
                  </SelectItem>
                  <SelectItem value="remove">
                    {i18n.t("importWizard.placeholders.removeFromContent")}
                  </SelectItem>
                  <SelectItem value="skip">
                    {i18n.t("importWizard.placeholders.skipSnippet")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Step 3 — Conflicts
  // ---------------------------------------------------------------------------

  const renderStep3 = () => (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {i18n.t("importWizard.conflicts.description", conflictEntries.length)}
      </p>

      {/* Resolve all */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border">
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          {i18n.t("importWizard.conflicts.resolveAll")}
        </span>
        <Select
          value={bulkConflictResolution}
          onValueChange={(v) => {
            setConflictEntriesCompat((prev) =>
              prev.map((c) => ({ ...c, resolution: v as ConflictResolution }))
            );
            setBulkConflictResolution("");
          }}
        >
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue
              placeholder={i18n.t("importWizard.conflicts.chooseResolution")}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">
              {i18n.t("importWizard.conflicts.skipDontImport")}
            </SelectItem>
            <SelectItem value="overwrite">
              {i18n.t("importWizard.conflicts.overwriteExisting")}
            </SelectItem>
            <SelectItem value="rename">
              {i18n.t("importWizard.conflicts.importWithNewShortcut")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="max-h-64 overflow-y-auto -mr-2 pr-2 space-y-2.5">
        {conflictEntries.map((entry, idx) => (
          <div
            key={entry.incoming.suggestedId}
            className="p-3 rounded-lg border space-y-2"
          >
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-0.5">
                <p className="text-muted-foreground/80 uppercase tracking-wide text-ui-micro! font-medium">
                  {i18n.t("importWizard.conflicts.incomingColumn")}
                </p>
                <p className="font-medium text-foreground">
                  {entry.incoming.label}
                </p>
                <p className="font-mono text-muted-foreground">
                  {entry.incoming.shortcut}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-muted-foreground/80 uppercase tracking-wide text-ui-micro! font-medium">
                  {i18n.t("importWizard.conflicts.existingColumn", [
                    entry.conflictType,
                  ])}
                </p>
                <p className="font-medium text-foreground">
                  {entry.existing.label}
                </p>
                <p className="font-mono text-muted-foreground">
                  {entry.existing.shortcut}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                {i18n.t("importWizard.conflicts.resolution")}
              </Label>
              <Select
                value={entry.resolution}
                onValueChange={(v) => {
                  setConflictEntriesCompat((prev) =>
                    prev.map((c, i) =>
                      i === idx
                        ? { ...c, resolution: v as ConflictResolution }
                        : c
                    )
                  );
                }}
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">
                    {i18n.t("importWizard.conflicts.skipDontImport")}
                  </SelectItem>
                  <SelectItem value="overwrite">
                    {i18n.t("importWizard.conflicts.overwriteExisting")}
                  </SelectItem>
                  <SelectItem value="rename">
                    {i18n.t("importWizard.conflicts.importWithNewShortcut")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {entry.resolution === "rename" && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground shrink-0">
                  {i18n.t("importWizard.conflicts.newShortcut")}
                </Label>
                <Input
                  value={entry.renamedShortcut ?? ""}
                  onChange={(e) => {
                    setConflictEntriesCompat((prev) =>
                      prev.map((c, i) =>
                        i === idx
                          ? { ...c, renamedShortcut: e.target.value }
                          : c
                      )
                    );
                  }}
                  className="h-7 text-xs font-mono flex-1"
                  placeholder={i18n.t(
                    "importWizard.conflicts.newShortcutPlaceholder"
                  )}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Step 4 — Confirm
  // ---------------------------------------------------------------------------

  const renderStep4 = () => {
    if (importDone) {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Icon
              icon={CheckCircle2}
              size="2xl"
              className="text-green-600 dark:text-green-400"
            />
          </div>
          <p className="text-base font-medium text-foreground">
            {i18n.t("importWizard.confirm.done.heading")}
          </p>
          <p className="text-sm text-muted-foreground">
            {i18n.t("importWizard.confirm.done.body", importedCount)}
          </p>
          <Button onClick={onClose} className="mt-2 h-8 text-sm">
            {i18n.t("importWizard.confirm.done.action")}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className="rounded-lg border divide-y">
          <div className="flex justify-between items-center px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">
              {i18n.t("importWizard.confirm.snippetsToImport")}
            </span>
            <span className="font-medium text-foreground">{snippetsToAdd}</span>
          </div>
          {isZipImport && zipMediaCount > 0 && (
            <div className="flex justify-between items-center px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {i18n.t("importWizard.confirm.imagesIncluded")}
              </span>
              <span className="font-medium text-foreground">
                {zipMediaCount}
              </span>
            </div>
          )}
          {overwrittenCount > 0 && (
            <div className="flex justify-between items-center px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {i18n.t("importWizard.confirm.overwritingExisting")}
              </span>
              <span className="font-medium text-foreground">
                {overwrittenCount}
              </span>
            </div>
          )}
          {renamedCount > 0 && (
            <div className="flex justify-between items-center px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {i18n.t("importWizard.confirm.importedWithRename")}
              </span>
              <span className="font-medium text-foreground">
                {renamedCount}
              </span>
            </div>
          )}
          {skippedCount > 0 && (
            <div className="flex justify-between items-center px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {i18n.t("importWizard.confirm.skippedConflicts")}
              </span>
              <span className="font-medium text-muted-foreground">
                {skippedCount}
              </span>
            </div>
          )}
        </div>

        {/* Quota */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{i18n.t("importWizard.confirm.estimatedStorage")}</span>
            <span>
              {(estimatedSize / 1024).toFixed(1)} KB /{" "}
              {(SYNC_QUOTA.TOTAL_BYTES / 1024).toFixed(0)} KB
            </span>
          </div>
          <Progress
            value={quotaPercent}
            aria-label={i18n.t("importWizard.confirm.estimatedStorage")}
            className={cn(quotaWillExceed ? "[&>div]:bg-amber-500" : "")}
          />
        </div>

        {quotaWillExceed && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs">
            <Icon icon={AlertTriangle} className="mt-0.5 shrink-0" />
            <span>{i18n.t("importWizard.confirm.quotaWarning")}</span>
          </div>
        )}

        {zipMissingMediaWarning && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs">
            <Icon icon={AlertTriangle} className="mt-0.5 shrink-0" />
            <span>{zipMissingMediaWarning}</span>
          </div>
        )}

        {importError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <Icon icon={AlertTriangle} className="mt-0.5 shrink-0" />
            {importError}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Footer actions
  // ---------------------------------------------------------------------------

  const renderFooter = () => {
    if (step === 4 && importDone) return null;

    return (
      <div className="flex justify-between pt-4 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (step === 1) onClose();
            else setStepCompat((s) => (s - 1) as WizardStep);
          }}
          disabled={importing}
        >
          <Icon icon={ChevronLeft} className="mr-1" />
          {step === 1
            ? i18n.t("importWizard.footer.cancel")
            : i18n.t("importWizard.footer.back")}
        </Button>

        {step < 4 && (
          <Button
            size="sm"
            onClick={() => {
              if (step === 1) advanceFromUpload();
              else if (step === 2) advanceFromPlaceholders();
              else if (step === 3) advanceFromStep3Compat();
            }}
            disabled={step === 1 && !canGoNext1}
          >
            {i18n.t("importWizard.footer.next")}
            <Icon icon={ChevronRight} className="ml-1" />
          </Button>
        )}

        {step === 4 && !importDone && (
          <Button
            size="sm"
            onClick={() => void runWizardImport()}
            disabled={importing || snippetsToAdd === 0}
          >
            {importing
              ? i18n.t("importWizard.footer.importing")
              : i18n.t("importWizard.footer.importCount", snippetsToAdd)}
          </Button>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Root
  // ---------------------------------------------------------------------------

  const stepContent = [renderStep1, renderStep2, renderStep3, renderStep4];

  return (
    <div className="flex flex-col gap-4">
      <StepIndicator current={step} labels={STEP_LABELS} />
      <div className="min-h-75">{stepContent[step - 1]()}</div>
      {renderFooter()}
    </div>
  );
}
