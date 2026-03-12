/**
 * Tests for src/storage/backends/local.ts — LocalBackend + updateContentScriptCache
 * spec: specs/storage.spec.md#LocalBackend
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalBackend, updateContentScriptCache } from "./local";
import { resetBrowserMocks } from "../../../tests/mocks/browser";
import type { Snippet } from "~/types";

// Mock the storage items used by LocalBackend
const { mockLocalSnippets, mockCachedSnippets } = vi.hoisted(() => ({
  mockLocalSnippets: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    removeValue: vi.fn(),
  },
  mockCachedSnippets: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    removeValue: vi.fn(),
  },
}));

vi.mock("../items", () => ({
  localSnippetsItem: mockLocalSnippets,
  cachedSnippetsItem: mockCachedSnippets,
}));

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "test-id",
  label: "Test",
  shortcut: "ts",
  content: "content",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("LocalBackend", () => {
  let backend: LocalBackend;

  beforeEach(() => {
    resetBrowserMocks();
    vi.clearAllMocks();
    backend = new LocalBackend();
  });

  // ── getSnippets ──────────────────────────────────────────────────────────

  describe("getSnippets", () => {
    // spec: MUST return the value of localSnippetsItem
    it("delegates to localSnippetsItem.getValue", async () => {
      const snippets = [makeSnippet()];
      mockLocalSnippets.getValue.mockResolvedValue(snippets);
      const result = await backend.getSnippets();
      expect(result).toEqual(snippets);
      expect(mockLocalSnippets.getValue).toHaveBeenCalled();
    });

    it("returns empty array by default", async () => {
      mockLocalSnippets.getValue.mockResolvedValue([]);
      const result = await backend.getSnippets();
      expect(result).toEqual([]);
    });
  });

  // ── saveSnippets ──────────────────────────────────────────────────────────

  describe("saveSnippets", () => {
    // spec: MUST set localSnippetsItem to the provided array
    it("calls localSnippetsItem.setValue with snippets", async () => {
      mockLocalSnippets.setValue.mockResolvedValue(undefined);
      const snippets = [makeSnippet()];
      await backend.saveSnippets(snippets);
      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith(snippets);
    });

    it("saves empty array", async () => {
      mockLocalSnippets.setValue.mockResolvedValue(undefined);
      await backend.saveSnippets([]);
      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith([]);
    });
  });

  // ── clear ────────────────────────────────────────────────────────────────

  describe("clear", () => {
    // spec: MUST call localSnippetsItem.removeValue
    it("calls localSnippetsItem.removeValue", async () => {
      mockLocalSnippets.removeValue.mockResolvedValue(undefined);
      await backend.clear();
      expect(mockLocalSnippets.removeValue).toHaveBeenCalled();
    });
  });
});

// ── updateContentScriptCache ────────────────────────────────────────────────

describe("updateContentScriptCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec: MUST set cachedSnippetsItem to the provided array
  it("sets cachedSnippetsItem to the provided snippets", async () => {
    mockCachedSnippets.setValue.mockResolvedValue(undefined);
    const snippets = [makeSnippet()];
    await updateContentScriptCache(snippets);
    expect(mockCachedSnippets.setValue).toHaveBeenCalledWith(snippets);
  });

  // spec: MUST NOT throw — catches and logs errors
  it("does not throw when cachedSnippetsItem.setValue throws", async () => {
    mockCachedSnippets.setValue.mockRejectedValue(new Error("Storage error"));
    await expect(updateContentScriptCache([])).resolves.not.toThrow();
  });
});
