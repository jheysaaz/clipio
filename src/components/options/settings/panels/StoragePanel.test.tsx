/**
 * Direct tests for the storage panel: its byte formatting and the decisions
 * that turn a stats object into a headline and a quota warning.
 *
 * The hook is replaced with a controlled value here so each mode and each
 * quota boundary can be tested without driving real browser storage. The hook
 * itself has its own tests.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatBytes, StoragePanel } from "./StoragePanel";
import type { StorageStats } from "../../useStorageStats";
import { i18n } from "../../../../../tests/mocks/i18n";

const { useStorageStats } = vi.hoisted(() => ({ useStorageStats: vi.fn() }));

vi.mock("../../useStorageStats", () => ({ useStorageStats }));

function stats(overrides: Partial<StorageStats> = {}): StorageStats {
  return {
    snippetCount: 0,
    syncBytesUsed: 0,
    localEstimatedBytes: 0,
    mode: "sync",
    localReason: "quota",
    loading: false,
    ...overrides,
  };
}

beforeEach(() => {
  useStorageStats.mockReturnValue(stats());
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("formatBytes", () => {
  it("renders zero and whole kilobytes without a pointless decimal", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(102_400)).toBe("100 KB");
  });

  it("rounds sub-kilobyte values to one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(512)).toBe("0.5 KB");
  });

  it("switches to megabytes at 1024 KB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatBytes(1258291)).toBe("1.2 MB");
  });
});

describe("StoragePanel", () => {
  it("reports sync mode as a sentence and shows the hard quota", () => {
    useStorageStats.mockReturnValue(stats({ snippetCount: 2 }));

    render(<StoragePanel />);

    expect(
      screen.getByText(i18n.t("options.storage.syncingAcross", 2))
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("options.storage.syncingHint"))
    ).toBeVisible();
    expect(screen.getByTestId("stat-sync-kb")).toHaveTextContent(
      "0 KB / 100 KB"
    );
    expect(screen.getByTestId("panel-storage")).toBeInTheDocument();
  });

  it("reports local mode and distinguishes a manual switch from a quota stop", () => {
    useStorageStats.mockReturnValue(
      stats({ snippetCount: 1, mode: "local", localReason: "manual" })
    );
    const manual = render(<StoragePanel />);
    expect(
      screen.getByText(i18n.t("options.storage.onlyHere", 1))
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("options.storage.reasonManual"))
    ).toBeVisible();
    manual.unmount();

    // A local mode caused by the quota must not claim the user chose it.
    useStorageStats.mockReturnValue(
      stats({ mode: "local", localReason: "quota", localEstimatedBytes: 2048 })
    );
    render(<StoragePanel />);
    expect(
      screen.getByText(i18n.t("options.storage.reasonQuota"))
    ).toBeVisible();
    expect(screen.getByTestId("stat-local-kb")).toHaveTextContent("~2 KB");
  });

  it("warns only once sync usage reaches the configured warn threshold", () => {
    useStorageStats.mockReturnValue(stats({ syncBytesUsed: 90_000 }));

    render(<StoragePanel />);

    expect(screen.getByTestId("stat-sync-kb")).toHaveTextContent(
      "87.9 KB / 100 KB"
    );
    expect(
      screen.getByText(i18n.t("options.storage.nearQuota", ["12.1 KB"]))
    ).toBeInTheDocument();
  });

  it("does not warn well below the threshold", () => {
    useStorageStats.mockReturnValue(stats({ syncBytesUsed: 1024 }));

    render(<StoragePanel />);

    expect(
      screen.queryByText(/Only .* left in sync storage/)
    ).not.toBeInTheDocument();
  });

  it("renders placeholders while stats are loading and hides the warning", () => {
    useStorageStats.mockReturnValue(
      stats({ loading: true, syncBytesUsed: 95_000 })
    );

    render(<StoragePanel />);

    expect(screen.getByTestId("stat-sync-kb")).toHaveTextContent("—");
    expect(screen.getByTestId("stat-local-kb")).toHaveTextContent("—");
    expect(
      screen.queryByText(/Only .* left in sync storage/)
    ).not.toBeInTheDocument();
  });

  it("keeps a negative free-space figure at zero instead of rendering a negative number", () => {
    useStorageStats.mockReturnValue(
      stats({ syncBytesUsed: 200_000, localEstimatedBytes: 8 * 1024 * 1024 })
    );

    render(<StoragePanel />);

    expect(screen.getByTestId("stat-sync-kb")).toHaveTextContent(
      "195.3 KB / 100 KB"
    );
    expect(
      screen.getAllByText(i18n.t("options.storage.roomLeft", ["0 KB"]))
    ).toHaveLength(2);
  });
});
