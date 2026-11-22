/**
 * Backup wizard sequencing.
 *
 * The assertions that matter: a file is only parsed and previewed first, a
 * conflict defaults to skip, and confirm is a no-op until a preview exists.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snippet } from "@/types";

const mocks = vi.hoisted(() => ({
  parseBackupFile: vi.fn(),
  buildBackupPreview: vi.fn(),
  getSnippets: vi.fn(),
  readBackupSettings: vi.fn(),
  restoreBackup: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@/lib/backup", () => ({
  parseBackupFile: mocks.parseBackupFile,
  buildBackupPreview: mocks.buildBackupPreview,
}));
vi.mock("@/storage", () => ({ getSnippets: mocks.getSnippets }));
vi.mock("@/storage/backup", () => ({
  readBackupSettings: mocks.readBackupSettings,
  restoreBackup: mocks.restoreBackup,
}));
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));

import {
  backupStore,
  confirmBackupRestore,
  initialBackupState,
  prepareBackup,
  resetBackup,
  setBackupConflictResolution,
} from "./backup";

const snippet: Snippet = {
  id: "s1",
  label: "One",
  shortcut: "/one",
  content: "Hello",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const preview = {
  sourceVersion: 3,
  exportedAt: "2026-11-21T12:00:00.000Z",
  snippetCount: 1,
  newSnippetCount: 0,
  conflictCount: 1,
  rejectedSnippetCount: 0,
  mediaCount: 0,
  missingMediaCount: 0,
  settingsChanges: [],
  settingsSkipped: [],
  conflicts: [
    {
      rowKey: "s1",
      incoming: {
        suggestedId: "s1",
        label: "One",
        shortcut: "/one",
        content: "New",
        tags: [],
        unsupportedPlaceholders: [],
      },
      existing: snippet,
      conflictType: "both" as const,
      resolution: "skip" as const,
    },
  ],
};

beforeEach(() => {
  resetBackup();
  mocks.parseBackupFile.mockReset();
  mocks.buildBackupPreview.mockReset();
  mocks.getSnippets.mockReset().mockResolvedValue([snippet]);
  mocks.readBackupSettings.mockReset().mockResolvedValue({});
  mocks.restoreBackup.mockReset().mockResolvedValue({
    snippetCount: 1,
    settingsApplied: [],
    settingsFailed: [],
    mediaRestored: 0,
    mediaFailed: [],
  });
  mocks.captureError.mockReset();
});

describe("prepareBackup", () => {
  it("parses and previews before any write", async () => {
    const backup = { document: {} };
    mocks.parseBackupFile.mockResolvedValue(backup);
    mocks.buildBackupPreview.mockReturnValue(preview);

    await prepareBackup(new File(["zip"], "backup.clipio.zip"));

    expect(mocks.parseBackupFile).toHaveBeenCalledOnce();
    expect(mocks.restoreBackup).not.toHaveBeenCalled();
    expect(mocks.buildBackupPreview).toHaveBeenCalledWith(
      backup,
      [snippet],
      {}
    );
    expect(backupStore.state.phase).toBe("preview");
    expect(backupStore.state.fileName).toBe("backup.clipio.zip");
    expect(backupStore.state.resolutions).toEqual({ s1: "skip" });
  });

  it("stores a stable error code when parsing fails", async () => {
    mocks.parseBackupFile.mockRejectedValue(
      new Error("Backup file is too large")
    );

    await prepareBackup(new File(["zip"], "huge.clipio.zip"));

    expect(backupStore.state.phase).toBe("error");
    expect(backupStore.state.errorCode).toBe("file-too-large");
    expect(mocks.captureError).toHaveBeenCalledOnce();
  });

  it("maps unsupported versions and malformed files to distinct codes", async () => {
    mocks.parseBackupFile
      .mockRejectedValueOnce(new Error("Unsupported backup version: 9"))
      .mockRejectedValueOnce(new Error("Backup manifest is not valid JSON"))
      .mockRejectedValueOnce(new Error("Invalid backup ZIP"))
      .mockRejectedValueOnce("unknown");

    for (const expected of [
      "unsupported-version",
      "invalid-json",
      "parse-failed",
      "parse-failed",
    ]) {
      await prepareBackup(new File(["x"], "bad.zip"));
      expect(backupStore.state.errorCode).toBe(expected);
    }
  });
});

describe("setBackupConflictResolution", () => {
  it("records a known conflict choice and ignores unknown keys", () => {
    backupStore.setState(() => ({
      ...initialBackupState,
      phase: "preview",
      preview,
      resolutions: { s1: "skip" },
    }));

    setBackupConflictResolution("s1", "overwrite");
    expect(backupStore.state.resolutions.s1).toBe("overwrite");

    setBackupConflictResolution("unknown", "overwrite");
    expect(backupStore.state.resolutions).toEqual({ s1: "overwrite" });
  });
});

describe("confirmBackupRestore", () => {
  it("does nothing without a preview", async () => {
    await confirmBackupRestore();

    expect(mocks.getSnippets).not.toHaveBeenCalled();
    expect(mocks.restoreBackup).not.toHaveBeenCalled();
    expect(backupStore.state.phase).toBe("idle");
  });

  it("passes the chosen resolutions to the restore writer", async () => {
    const backup = { document: {} };
    backupStore.setState(() => ({
      ...initialBackupState,
      phase: "preview",
      backup: backup as never,
      preview,
      resolutions: { s1: "overwrite" },
    }));

    await confirmBackupRestore();

    expect(mocks.restoreBackup).toHaveBeenCalledWith(
      backup,
      [expect.objectContaining({ rowKey: "s1", resolution: "overwrite" })],
      [snippet]
    );
    expect(backupStore.state.phase).toBe("done");
    expect(backupStore.state.result?.snippetCount).toBe(1);
  });

  it("reports a failed write without leaving the dialog spinning", async () => {
    mocks.restoreBackup.mockRejectedValue(new Error("disk full"));
    backupStore.setState(() => ({
      ...initialBackupState,
      phase: "preview",
      backup: {} as never,
      preview,
      resolutions: {},
    }));

    await confirmBackupRestore();

    expect(backupStore.state.phase).toBe("error");
    expect(backupStore.state.errorCode).toBe("restore-failed");
    expect(mocks.captureError).toHaveBeenCalledOnce();
  });
});
