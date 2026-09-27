/**
 * Tests for src/storage/backends/local.ts — LocalBackend + updateContentScriptCache
 * spec: specs/storage.spec.md#LocalBackend
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalBackend, updateContentScriptCache } from "./local";
import { resetBrowserMocks } from "../../../tests/mocks/browser";
import type { Snippet } from "@/types";

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

    // spec: specs/storage.spec.md#LocalBackend — legacy snippets without
    // The legacy contentFormat flag is converted away on read.
    // spec: specs/content-format-migration.spec.md
    it("converts a legacy HTML body to markdown and drops the flag", async () => {
      const legacy = {
        ...makeSnippet(),
        content: "<strong>Bold</strong> and <em>italic</em>",
        contentFormat: "html",
      } as unknown as Snippet;
      mockLocalSnippets.getValue.mockResolvedValue([legacy]);
      const result = await backend.getSnippets();
      expect(result[0].content).toContain("**Bold**");
      expect(result[0].content).toContain("_italic_");
      expect(Object.keys(result[0])).not.toContain("contentFormat");
    });

    it("leaves a markdown snippet untouched", async () => {
      const plain = { ...makeSnippet(), content: "**already** markdown" };
      mockLocalSnippets.getValue.mockResolvedValue([plain]);
      const result = await backend.getSnippets();
      expect(result[0].content).toBe("**already** markdown");
    });

    it("preserves an unrecognised format value rather than guessing", async () => {
      // A value this version does not know about must not be silently
      // rewritten as markdown, or a future format would be destroyed on read.
      const future = {
        ...makeSnippet(),
        content: "body",
        contentFormat: "some-future-format",
      } as unknown as Snippet;
      mockLocalSnippets.getValue.mockResolvedValue([future]);
      const result = await backend.getSnippets();
      expect(result[0].content).toBe("body");
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

  // ── upsertSnippets / removeSnippetsById ─────────────────────────────────
  //
  // The intent-based API from specs/storage-durability.spec.md. These exist so
  // two extension contexts can each change one snippet without the second
  // write clobbering the first, which is what a whole-list save did.

  describe("upsertSnippets", () => {
    it("adds a snippet to an empty store", async () => {
      mockLocalSnippets.getValue.mockResolvedValue([]);
      const snippet = makeSnippet({ id: "a" });

      await backend.upsertSnippets([snippet]);

      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith([snippet]);
    });

    it("keeps a snippet it did not mention", async () => {
      // The regression this API exists for: a whole-list save would have
      // dropped the untouched snippet.
      const existing = makeSnippet({ id: "keep" });
      mockLocalSnippets.getValue.mockResolvedValue([existing]);
      const added = makeSnippet({ id: "added" });

      await backend.upsertSnippets([added]);

      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith([
        existing,
        added,
      ]);
    });

    it("replaces a snippet with the same id rather than duplicating it", async () => {
      mockLocalSnippets.getValue.mockResolvedValue([
        makeSnippet({ id: "a", content: "old" }),
      ]);

      await backend.upsertSnippets([makeSnippet({ id: "a", content: "new" })]);

      const written = mockLocalSnippets.setValue.mock.calls[0]![0] as Snippet[];
      expect(written).toHaveLength(1);
      expect(written[0]!.content).toBe("new");
    });

    it("does not write at all for an empty list", async () => {
      // A no-op write would still race another context's write.
      mockLocalSnippets.getValue.mockResolvedValue([makeSnippet()]);

      await backend.upsertSnippets([]);

      expect(mockLocalSnippets.setValue).not.toHaveBeenCalled();
    });
  });

  describe("removeSnippetsById", () => {
    it("removes only the named ids", async () => {
      const keep = makeSnippet({ id: "keep" });
      mockLocalSnippets.getValue.mockResolvedValue([
        keep,
        makeSnippet({ id: "drop1" }),
        makeSnippet({ id: "drop2" }),
      ]);

      await backend.removeSnippetsById(["drop1", "drop2"]);

      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith([keep]);
    });

    it("leaves the store untouched when no id matches", async () => {
      const existing = [makeSnippet({ id: "a" }), makeSnippet({ id: "b" })];
      mockLocalSnippets.getValue.mockResolvedValue(existing);

      await backend.removeSnippetsById(["absent"]);

      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith(existing);
    });

    it("ignores an id that is not present", async () => {
      mockLocalSnippets.getValue.mockResolvedValue([makeSnippet({ id: "a" })]);

      await backend.removeSnippetsById(["a", "ghost"]);

      expect(mockLocalSnippets.setValue).toHaveBeenCalledWith([]);
    });

    it("does not write at all for an empty id list", async () => {
      mockLocalSnippets.getValue.mockResolvedValue([makeSnippet()]);

      await backend.removeSnippetsById([]);

      expect(mockLocalSnippets.setValue).not.toHaveBeenCalled();
    });
  });

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
