/**
 * BackupManager renders decisions, it does not make them. These tests prove
 * that preview data and user choices flow through to the right actions, and
 * that a failed backup still tells the user instead of failing silently.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupState } from "@/store/backup";

import { i18n } from "../../tests/mocks/i18n";

const mocks = vi.hoisted(() => ({
  createBackupFile: vi.fn(),
  downloadBackup: vi.fn(),
  prepareBackup: vi.fn(),
  confirmBackupRestore: vi.fn(),
  setBackupConflictResolution: vi.fn(),
  captureError: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/storage/backup", () => ({
  createBackupFile: mocks.createBackupFile,
  downloadBackup: mocks.downloadBackup,
}));
vi.mock("@/store/backup", async () => {
  const actual =
    await vi.importActual<typeof import("@/store/backup")>("@/store/backup");
  return {
    ...actual,
    prepareBackup: mocks.prepareBackup,
    confirmBackupRestore: mocks.confirmBackupRestore,
    setBackupConflictResolution: mocks.setBackupConflictResolution,
  };
});
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { BackupManager } from "./BackupManager";
import { backupStore } from "@/store/backup";

const preview = {
  sourceVersion: 3,
  exportedAt: "2026-11-21T12:00:00.000Z",
  snippetCount: 2,
  newSnippetCount: 1,
  conflictCount: 1,
  rejectedSnippetCount: 0,
  mediaCount: 1,
  missingMediaCount: 0,
  settingsChanges: [{ key: "themeMode", from: "light", to: "dark" }],
  settingsSkipped: [{ key: "sidebarWidth", reason: "invalid-value" as const }],
  conflicts: [
    {
      rowKey: "s1",
      incoming: {
        suggestedId: "s1",
        label: "Greeting",
        shortcut: "/hello",
        content: "New",
        tags: [],
        unsupportedPlaceholders: [],
      },
      existing: {
        id: "s1",
        label: "Greeting",
        shortcut: "/hello",
        content: "Old",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      conflictType: "both" as const,
      resolution: "skip" as const,
      renamedShortcut: "/hello_2",
    },
  ],
};

const idleState: BackupState = {
  phase: "idle",
  fileName: null,
  errorCode: null,
  backup: null,
  preview: null,
  resolutions: {},
  result: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createBackupFile.mockResolvedValue({
    blob: new Blob(["zip"]),
    fileName: "clipio-backup-2026-11-21.clipio.zip",
  });
  backupStore.setState(() => ({ ...idleState }));
});

describe("BackupManager controls", () => {
  it("creates and downloads a backup, with its own test id", async () => {
    render(<BackupManager />);

    fireEvent.click(screen.getByTestId("backup-create"));

    await waitFor(() => {
      expect(mocks.createBackupFile).toHaveBeenCalledOnce();
      expect(mocks.downloadBackup).toHaveBeenCalledWith(
        expect.any(Blob),
        "clipio-backup-2026-11-21.clipio.zip"
      );
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("options.backup.created")
      );
    });
  });

  it("reports a failed backup without pretending it worked", async () => {
    mocks.createBackupFile.mockRejectedValue(new Error("disk full"));
    render(<BackupManager />);

    fireEvent.click(screen.getByTestId("backup-create"));

    await waitFor(() => {
      expect(mocks.downloadBackup).not.toHaveBeenCalled();
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.t("options.backup.failedCreate")
      );
      expect(mocks.captureError).toHaveBeenCalledOnce();
    });
  });

  it("opens the file picker through its button, not by accepting literal copy", () => {
    render(<BackupManager />);

    const input = screen.getByTestId("backup-file-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("backup-restore-open"));

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("passes the chosen file to the prepare step and clears the input", () => {
    render(<BackupManager />);

    const input = screen.getByTestId("backup-file-input") as HTMLInputElement;
    const file = new File(["zip"], "backup.clipio.zip");
    fireEvent.change(input, { target: { files: [file] } });

    expect(mocks.prepareBackup).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });
});

describe("BackupManager preview dialog", () => {
  beforeEach(() => {
    backupStore.setState(() => ({
      ...idleState,
      phase: "preview",
      fileName: "backup.clipio.zip",
      preview,
      resolutions: { s1: "skip" },
    }));
  });

  it("shows conflicts and settings before asking for confirmation", () => {
    render(<BackupManager />);

    expect(screen.getByTestId("backup-preview-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("backup-summary")).toBeInTheDocument();
    expect(screen.getByTestId("backup-conflict-count")).toHaveTextContent("1");
    expect(screen.getByTestId("backup-conflict-row")).toHaveTextContent(
      "Greeting"
    );
    expect(screen.getByTestId("backup-setting-change")).toHaveTextContent(
      "themeMode"
    );
    expect(screen.getByTestId("backup-settings-skipped")).toHaveTextContent(
      "sidebarWidth"
    );
    expect(screen.getByTestId("backup-restore-confirm")).toBeInTheDocument();
  });

  it("records a resolution change and only writes on confirm", () => {
    render(<BackupManager />);

    const select = screen.getByTestId(
      "backup-conflict-resolution"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "overwrite" } });

    expect(mocks.setBackupConflictResolution).toHaveBeenCalledWith(
      "s1",
      "overwrite"
    );
    expect(mocks.confirmBackupRestore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("backup-restore-confirm"));

    expect(mocks.confirmBackupRestore).toHaveBeenCalledOnce();
  });

  it("cancels back to idle without writing", () => {
    render(<BackupManager />);

    fireEvent.click(screen.getByTestId("backup-restore-cancel"));

    expect(
      screen.queryByTestId("backup-preview-dialog")
    ).not.toBeInTheDocument();
    expect(mocks.confirmBackupRestore).not.toHaveBeenCalled();
  });

  it("shows an error with its own test id", () => {
    backupStore.setState((s) => ({
      ...s,
      phase: "error",
      errorCode: "unsupported-version",
      preview: null,
    }));
    render(<BackupManager />);

    expect(screen.getByTestId("backup-error")).toHaveTextContent(
      i18n.t("options.backup.errors.unsupportedVersion")
    );
    expect(screen.getByTestId("backup-dialog-close")).toBeInTheDocument();
  });

  it("shows a busy state and no footer while the file is being read", () => {
    backupStore.setState((s) => ({
      ...s,
      phase: "loading",
      preview: null,
    }));
    render(<BackupManager />);

    expect(screen.getByTestId("backup-busy")).toBeInTheDocument();
    expect(
      screen.queryByTestId("backup-restore-confirm")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("backup-dialog-close")).not.toBeInTheDocument();
  });

  it.each([
    ["file-too-large", "fileTooLarge"],
    ["invalid-json", "invalidJson"],
    ["missing-manifest", "missingManifest"],
    ["restore-failed", "restoreFailed"],
  ])("names the %s failure in the dialog", (code, key) => {
    backupStore.setState((s) => ({
      ...s,
      phase: "error",
      errorCode: code,
      preview: null,
    }));
    render(<BackupManager />);

    expect(screen.getByTestId("backup-error")).toHaveTextContent(
      i18n.t(`options.backup.errors.${key}`)
    );
  });

  it("shows the no-changes state and warns about rejected and missing media", () => {
    backupStore.setState((s) => ({
      ...s,
      preview: {
        ...preview,
        settingsChanges: [],
        settingsSkipped: [],
        conflicts: [],
        rejectedSnippetCount: 2,
        missingMediaCount: 1,
      },
      resolutions: {},
    }));
    render(<BackupManager />);

    expect(screen.getByTestId("backup-no-setting-changes")).toBeInTheDocument();
    expect(screen.getByTestId("backup-rejected-count")).toHaveTextContent("2");
    expect(screen.getByTestId("backup-missing-media")).toHaveTextContent("1");
  });

  it("shows the done state even without a result payload", () => {
    backupStore.setState((s) => ({
      ...s,
      phase: "done",
      preview: null,
      result: null,
    }));
    render(<BackupManager />);

    expect(document.getElementById("backup-dialog-title")).toHaveTextContent(
      i18n.t("options.backup.doneTitle")
    );
    expect(screen.queryByTestId("backup-result")).not.toBeInTheDocument();
    expect(screen.getByTestId("backup-dialog-close")).toBeInTheDocument();
  });

  it("shows the done summary after a restore", () => {
    backupStore.setState((s) => ({
      ...s,
      phase: "done",
      preview: null,
      result: {
        snippetCount: 2,
        settingsApplied: ["themeMode"],
        settingsFailed: [
          { key: "sidebarWidth", reason: "invalid-value" as const },
        ],
        mediaRestored: 1,
        mediaFailed: [],
      },
    }));
    render(<BackupManager />);

    expect(screen.getByTestId("backup-result")).toHaveTextContent("2");
    expect(screen.getByTestId("backup-result-skipped")).toBeInTheDocument();
  });
});
