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
  X,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import { getSnippets, getStorageStatus } from "~/storage";
import { bulkSaveSnippets } from "~/storage";
import type { Snippet } from "~/types";
import { createSnippet } from "~/types";
import { detectFormat } from "~/lib/importers/detect";
import { TextBlazeParser } from "~/lib/importers/textblaze";
import { ClipioParser } from "~/lib/importers/clipio";
import { PowerTextParser } from "~/lib/importers/powertext";
import type {
  FormatId,
  ParsedSnippet,
  ConflictEntry,
  ConflictResolution,
  UnsupportedPlaceholderEntry,
  UnsupportedPlaceholderAction,
} from "~/lib/importers/types";
import { SYNC_QUOTA } from "~/config/constants";
import { captureError } from "~/lib/sentry";
import { i18n } from "#i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4;

interface ImportWizardProps {
  onClose: () => void;
  onImportComplete: (count: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PARSERS = {
  clipio: ClipioParser,
  textblaze: TextBlazeParser,
  powertext: PowerTextParser,
} as const;

function applyUnsupportedAction(
  snippet: ParsedSnippet,
  action: UnsupportedPlaceholderAction
): ParsedSnippet | null {
  if (action === "skip") return null;
  if (action === "remove") {
    // Strip any remaining {token} patterns (single-brace) that are NOT our {{...}} ones
    const cleaned = snippet.content.replace(/(?<!\{)\{(?!\{)[^}]+\}/g, "");
    return { ...snippet, content: cleaned, unsupportedPlaceholders: [] };
  }
  // "keep" — leave as literal text
  return { ...snippet, unsupportedPlaceholders: [] };
}

function detectConflicts(
  incoming: ParsedSnippet[],
  existing: Snippet[]
): ConflictEntry[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const byShortcut = new Map(existing.map((s) => [s.shortcut, s]));
  const entries: ConflictEntry[] = [];

  for (const snippet of incoming) {
    const idMatch = byId.get(snippet.suggestedId);
    const shortcutMatch = byShortcut.get(snippet.shortcut);

    if (!idMatch && !shortcutMatch) continue;

    // Determine conflict type
    let conflictType: ConflictEntry["conflictType"] = "id";
    let existing: Snippet;
    if (idMatch && shortcutMatch && idMatch.id === shortcutMatch.id) {
      conflictType = "both";
      existing = idMatch;
    } else if (idMatch) {
      conflictType = "id";
      existing = idMatch;
    } else {
      conflictType = "shortcut";
      existing = shortcutMatch!;
    }

    entries.push({
      incoming: snippet,
      existing,
      conflictType,
      resolution: "skip",
    });
  }

  return entries;
}

function suggestShortcut(base: string, existing: Snippet[]): string {
  const taken = new Set(existing.map((s) => s.shortcut));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

function estimateJsonSize(snippets: Snippet[]): number {
  return JSON.stringify(snippets).length;
}

function buildFinalSnippets(
  existing: Snippet[],
  incoming: ParsedSnippet[],
  conflicts: ConflictEntry[]
): Snippet[] {
  const conflictByShortcut = new Map(
    conflicts.map((c) => [c.incoming.shortcut, c])
  );
  const conflictById = new Map(
    conflicts.map((c) => [c.incoming.suggestedId, c])
  );

  // IDs of existing snippets to remove (overwritten ones)
  const idsToRemove = new Set<string>();
  for (const c of conflicts) {
    if (c.resolution === "overwrite") {
      idsToRemove.add(c.existing.id);
    }
  }

  const base = existing.filter((s) => !idsToRemove.has(s.id));

  const toAdd: Snippet[] = [];
  const now = new Date().toISOString();

  for (const parsed of incoming) {
    const idConflict = conflictById.get(parsed.suggestedId);
    const shortcutConflict = conflictByShortcut.get(parsed.shortcut);
    const conflict = idConflict ?? shortcutConflict;

    if (conflict) {
      if (conflict.resolution === "skip") continue;
      if (conflict.resolution === "overwrite") {
        // Already removed the existing one above
        toAdd.push({
          id: parsed.suggestedId,
          label: parsed.label,
          shortcut: parsed.shortcut,
          content: parsed.content,
          tags: parsed.tags,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      } else if (conflict.resolution === "rename") {
        const newShortcut = conflict.renamedShortcut ?? parsed.shortcut;
        toAdd.push({
          id: crypto.randomUUID(),
          label: parsed.label,
          shortcut: newShortcut,
          content: parsed.content,
          tags: parsed.tags,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      toAdd.push({
        id: parsed.suggestedId,
        label: parsed.label,
        shortcut: parsed.shortcut,
        content: parsed.content,
        tags: parsed.tags,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return [...base, ...toAdd];
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
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : stepNum}
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
              <ChevronRight className="h-3 w-3 text-muted-foreground/50 mx-0.5" />
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
  const [step, setStep] = useState<WizardStep>(1);
  const [existingSnippets, setExistingSnippets] = useState<Snippet[]>([]);

  // Step 1
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<
    Record<string, unknown> | unknown[] | null
  >(null);
  const [detectedFormat, setDetectedFormat] = useState<FormatId | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<FormatId | "">("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedSnippets, setParsedSnippets] = useState<ParsedSnippet[]>([]);

  // Step 2
  const [unsupportedEntries, setUnsupportedEntries] = useState<
    UnsupportedPlaceholderEntry[]
  >([]);
  const [bulkUnsupportedAction, setBulkUnsupportedAction] = useState("");

  // Step 3
  const [conflictEntries, setConflictEntries] = useState<ConflictEntry[]>([]);
  const [bulkConflictResolution, setBulkConflictResolution] = useState("");

  // Step 4
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<"sync" | "local">("sync");

  // Load existing snippets & storage status on mount
  useEffect(() => {
    getSnippets().then(setExistingSnippets).catch(console.error);
    getStorageStatus()
      .then((s) => setStorageMode(s.mode))
      .catch(console.error);
  }, []);

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------

  const processFile = useCallback(
    (file: File) => {
      setParseError(null);
      setFileName(file.name);

      file
        .text()
        .then((text) => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            setParseError(i18n.t("importWizard.upload.invalidJson"));
            return;
          }

          setRawJson(json as Record<string, unknown> | unknown[]);
          const fmt = detectFormat(json);
          setDetectedFormat(fmt);
          setSelectedFormat(fmt ?? "");

          if (fmt) {
            tryParse(json, fmt);
          }
        })
        .catch(() => setParseError(i18n.t("importWizard.upload.couldNotRead")));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function tryParse(json: unknown, format: FormatId) {
    try {
      const parser = PARSERS[format];
      const snippets = parser.parse(json);
      setParsedSnippets(snippets);
      setParseError(null);
    } catch (e) {
      setParseError(
        e instanceof Error
          ? e.message
          : i18n.t("importWizard.upload.failedToParse")
      );
      setParsedSnippets([]);
    }
  }

  function handleFormatChange(fmt: FormatId) {
    setSelectedFormat(fmt);
    if (rawJson) tryParse(rawJson, fmt);
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  // ---------------------------------------------------------------------------
  // Step navigation
  // ---------------------------------------------------------------------------

  function advanceFromStep1() {
    // Prepare step 2: collect snippets with unsupported placeholders
    const withUnsupported = parsedSnippets.filter(
      (s) => s.unsupportedPlaceholders.length > 0
    );

    if (withUnsupported.length > 0) {
      setUnsupportedEntries(
        withUnsupported.map((s) => ({ snippet: s, action: "keep" }))
      );
      setStep(2);
    } else {
      prepareStep3(parsedSnippets);
    }
  }

  function applyUnsupportedAndAdvance() {
    // Apply actions to the parsed snippets
    const modified: ParsedSnippet[] = [];
    const unsupportedMap = new Map(
      unsupportedEntries.map((e) => [e.snippet.suggestedId, e.action])
    );

    for (const snippet of parsedSnippets) {
      const action = unsupportedMap.get(snippet.suggestedId) ?? "keep";
      const result = applyUnsupportedAction(snippet, action);
      if (result !== null) modified.push(result);
    }

    prepareStep3(modified);
  }

  function prepareStep3(snippets: ParsedSnippet[]) {
    // Update parsedSnippets with the potentially modified set
    setParsedSnippets(snippets);
    const conflicts = detectConflicts(snippets, existingSnippets);

    if (conflicts.length > 0) {
      // Pre-fill renamed shortcuts
      const filled = conflicts.map((c) => ({
        ...c,
        renamedShortcut:
          c.resolution === "rename"
            ? suggestShortcut(c.incoming.shortcut, existingSnippets)
            : suggestShortcut(c.incoming.shortcut, existingSnippets),
      }));
      setConflictEntries(filled);
      setStep(3);
    } else {
      setConflictEntries([]);
      setStep(4);
    }
  }

  function advanceFromStep3() {
    setStep(4);
  }

  // ---------------------------------------------------------------------------
  // Final import
  // ---------------------------------------------------------------------------

  async function handleImport() {
    setImporting(true);
    try {
      const finalSnippets = buildFinalSnippets(
        existingSnippets,
        parsedSnippets,
        conflictEntries
      );
      await bulkSaveSnippets(finalSnippets);
      const count =
        finalSnippets.length -
        existingSnippets.length +
        conflictEntries.filter((c) => c.resolution === "overwrite").length;
      setImportedCount(count);
      setImportDone(true);
      onImportComplete(count);
    } catch (e) {
      console.error("[Clipio] Import failed:", e);
      captureError(e, { action: "importSnippets" });
      setImportError(i18n.t("importWizard.confirm.failedToImport"));
    } finally {
      setImporting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Computed values for step 4
  // ---------------------------------------------------------------------------

  const finalSnippetPreview = buildFinalSnippets(
    existingSnippets,
    parsedSnippets,
    conflictEntries
  );
  const estimatedSize = estimateJsonSize(finalSnippetPreview);
  const quotaPercent = Math.min(
    100,
    Math.round((estimatedSize / SYNC_QUOTA.TOTAL_BYTES) * 100)
  );
  const willExceedQuota =
    storageMode !== "local" && estimatedSize > SYNC_QUOTA.WARN_AT;

  const skippedCount = conflictEntries.filter(
    (c) => c.resolution === "skip"
  ).length;
  const overwrittenCount = conflictEntries.filter(
    (c) => c.resolution === "overwrite"
  ).length;
  const renamedCount = conflictEntries.filter(
    (c) => c.resolution === "rename"
  ).length;
  // Every parsed snippet that isn't explicitly skipped gets imported
  // (as new, overwrite, or rename) — overwrittenCount is already included
  // in parsedSnippets.length so must NOT be added again.
  const snippetsToAdd = parsedSnippets.length - skippedCount;

  const STEP_LABELS = [
    i18n.t("importWizard.steps.upload"),
    i18n.t("importWizard.steps.placeholders"),
    i18n.t("importWizard.steps.conflicts"),
    i18n.t("importWizard.steps.confirm"),
  ];

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const canGoNext1 =
    parsedSnippets.length > 0 && !parseError && !!selectedFormat;

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
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) processFile(f);
            e.target.value = "";
          }}
        />
        {fileName ? (
          <div className="flex flex-col items-center gap-2">
            <FileJson
              className="h-8 w-8 text-muted-foreground"
              strokeWidth={1.5}
            />
            <p className="text-sm font-medium text-foreground">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {i18n.t("importWizard.upload.clickToChange")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload
              className="h-8 w-8 text-muted-foreground"
              strokeWidth={1.5}
            />
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
            {detectedFormat ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                {PARSERS[detectedFormat].iconUrl && (
                  <img
                    src={PARSERS[detectedFormat].iconUrl}
                    alt=""
                    className="w-3.5 h-3.5 rounded-sm object-contain"
                    onError={(e) =>
                      ((e.target as HTMLImageElement).style.display = "none")
                    }
                  />
                )}
                {PARSERS[detectedFormat].displayName}
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
              {(
                Object.values(
                  PARSERS
                ) as (typeof PARSERS)[keyof typeof PARSERS][]
              ).map((parser) => (
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
          <AlertTriangle
            className="h-3.5 w-3.5 mt-0.5 shrink-0"
            strokeWidth={1.5}
          />
          {parseError}
        </div>
      )}
      {parsedSnippets.length > 0 && !parseError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border text-xs text-muted-foreground">
          <CheckCircle2
            className="h-3.5 w-3.5 text-green-500 shrink-0"
            strokeWidth={1.5}
          />
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
            setUnsupportedEntries((prev) =>
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
                  setUnsupportedEntries((prev) =>
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
            setConflictEntries((prev) =>
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
                <p className="text-muted-foreground/80 uppercase tracking-wide text-[10px] font-medium">
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
                <p className="text-muted-foreground/80 uppercase tracking-wide text-[10px] font-medium">
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
                  setConflictEntries((prev) =>
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
                    setConflictEntries((prev) =>
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
            <CheckCircle2
              className="h-6 w-6 text-green-600 dark:text-green-400"
              strokeWidth={1.5}
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
            className={cn(willExceedQuota ? "[&>div]:bg-amber-500" : "")}
          />
        </div>

        {willExceedQuota && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs">
            <AlertTriangle
              className="h-3.5 w-3.5 mt-0.5 shrink-0"
              strokeWidth={1.5}
            />
            <span>{i18n.t("importWizard.confirm.quotaWarning")}</span>
          </div>
        )}

        {importError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <AlertTriangle
              className="h-3.5 w-3.5 mt-0.5 shrink-0"
              strokeWidth={1.5}
            />
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
            else setStep((s) => (s - 1) as WizardStep);
          }}
          disabled={importing}
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
          {step === 1
            ? i18n.t("importWizard.footer.cancel")
            : i18n.t("importWizard.footer.back")}
        </Button>

        {step < 4 && (
          <Button
            size="sm"
            onClick={() => {
              if (step === 1) advanceFromStep1();
              else if (step === 2) applyUnsupportedAndAdvance();
              else if (step === 3) advanceFromStep3();
            }}
            disabled={step === 1 && !canGoNext1}
          >
            {i18n.t("importWizard.footer.next")}
            <ChevronRight className="h-3.5 w-3.5 ml-1" strokeWidth={1.5} />
          </Button>
        )}

        {step === 4 && !importDone && (
          <Button
            size="sm"
            onClick={handleImport}
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
