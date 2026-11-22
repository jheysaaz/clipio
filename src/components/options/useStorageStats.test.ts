/**
 * Direct tests for the storage-stats hook.
 *
 * The hook combines three async sources and has two distinct failure shapes: a
 * quota-bytes failure that degrades to zero, and a snippets/status failure that
 * leaves the hook with its initial figures but stops saying "loading".
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSnippets: vi.fn(),
  getStorageStatus: vi.fn(),
}));

vi.mock("@/storage", () => ({
  getSnippets: mocks.getSnippets,
  getStorageStatus: mocks.getStorageStatus,
}));

import { useStorageStats } from "./useStorageStats";
import { mockStorageSync } from "../../../tests/mocks/browser";

const originalBytesInUse =
  mockStorageSync.getBytesInUse.getMockImplementation();

const snippet = { id: "s1", label: "One", content: "hello" };

beforeEach(() => {
  mocks.getSnippets.mockReset().mockResolvedValue([snippet]);
  mocks.getStorageStatus
    .mockReset()
    .mockResolvedValue({ mode: "sync", localReason: "quota" });
  mockStorageSync.getBytesInUse.mockReset().mockResolvedValue(2048);
});

afterEach(() => {
  mocks.getSnippets.mockReset();
  mocks.getStorageStatus.mockReset();
  mockStorageSync.getBytesInUse.mockReset();
  mockStorageSync.getBytesInUse.mockImplementation(originalBytesInUse!);
});

describe("useStorageStats", () => {
  it("starts in the loading state before any source resolves", () => {
    const { result } = renderHook(() => useStorageStats());

    expect(result.current.loading).toBe(true);
    expect(result.current.snippetCount).toBe(0);
  });

  it("combines snippets, status and sync bytes into one result", async () => {
    const { result } = renderHook(() => useStorageStats());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      snippetCount: 1,
      syncBytesUsed: 2048,
      localEstimatedBytes: JSON.stringify([snippet]).length,
      mode: "sync",
      localReason: "quota",
    });
  });

  it("reports local mode and the reason the status gave", async () => {
    mocks.getStorageStatus.mockResolvedValue({
      mode: "local",
      localReason: "manual",
    });

    const { result } = renderHook(() => useStorageStats());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("local");
    expect(result.current.localReason).toBe("manual");
  });

  it("falls back to zero when sync byte accounting is unavailable", async () => {
    mockStorageSync.getBytesInUse.mockRejectedValue(new Error("not available"));

    const { result } = renderHook(() => useStorageStats());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.syncBytesUsed).toBe(0);
    expect(result.current.snippetCount).toBe(1);
  });

  it("stops loading without inventing figures when snippets cannot be read", async () => {
    mocks.getSnippets.mockRejectedValue(new Error("storage locked"));

    const { result } = renderHook(() => useStorageStats());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      snippetCount: 0,
      syncBytesUsed: 0,
      localEstimatedBytes: 0,
      mode: "sync",
    });
  });

  it("stops loading when the storage status read fails", async () => {
    mocks.getStorageStatus.mockRejectedValue(new Error("status unavailable"));

    const { result } = renderHook(() => useStorageStats());

    // Promise.all rejects as a unit: the successfully-read snippets are not
    // applied, so the panel falls back to its initial figures rather than a
    // half-loaded mix of old and new data.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      mode: "sync",
      snippetCount: 0,
    });
  });
});
