/**
 * Tests for src/lib/giphy.ts
 * spec: specs/giphy.spec.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  search,
  trending,
  getById,
  getGiphyApiKey,
  buildGifUrl,
  buildGifPreviewUrl,
  GiphyAuthError,
  GiphyRateLimitError,
  GiphyNetworkError,
} from "./giphy";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

const mockGiphyApiKey = vi.hoisted(() => ({
  getValue: vi.fn(async () => ""),
  setValue: vi.fn(),
}));

vi.mock("~/storage/items", () => ({
  giphyApiKeyItem: mockGiphyApiKey,
  // other items not needed in this test
  localSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  cachedSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  contextMenuDraftItem: { getValue: vi.fn(), setValue: vi.fn() },
  blockedSitesItem: { getValue: vi.fn(), setValue: vi.fn() },
}));

import { captureError } from "~/lib/sentry";

// ---------------------------------------------------------------------------
// Giphy mock response builder
// ---------------------------------------------------------------------------

function makeGiphyGifItem(id = "abc123") {
  return {
    id,
    title: `GIF ${id}`,
    images: {
      fixed_width_small: {
        url: `https://media.giphy.com/media/${id}/100w.gif`,
        webp: `https://media.giphy.com/media/${id}/100w.webp`,
      },
      original: {
        url: `https://media.giphy.com/media/${id}/giphy.gif`,
        width: "480",
        height: "270",
      },
    },
  };
}

function mockFetchSuccess(
  data: unknown,
  pagination = { total_count: 1, offset: 0 }
) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data, pagination }),
  });
}

function mockFetchError(status: number) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
  });
}

function mockFetchNetworkError() {
  global.fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Network failure"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WXT_GIPHY_API_KEY", "env-default-giphy-key");
  mockGiphyApiKey.getValue.mockResolvedValue(""); // use default key
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// buildGifUrl / buildGifPreviewUrl (pure helpers)
// ---------------------------------------------------------------------------

describe("buildGifUrl", () => {
  it("returns the correct Giphy CDN URL", () => {
    expect(buildGifUrl("abc123")).toBe(
      "https://media.giphy.com/media/abc123/giphy.gif"
    );
  });
});

describe("buildGifPreviewUrl", () => {
  it("returns the 200w preview URL", () => {
    expect(buildGifPreviewUrl("abc123")).toBe(
      "https://media.giphy.com/media/abc123/200w.gif"
    );
  });
});

// ---------------------------------------------------------------------------
// getGiphyApiKey
// ---------------------------------------------------------------------------

describe("getGiphyApiKey", () => {
  it("returns the env default key when no override is set", async () => {
    mockGiphyApiKey.getValue.mockResolvedValueOnce("");
    const key = await getGiphyApiKey();
    expect(key).toBe("env-default-giphy-key");
  });

  it("returns the user override when set", async () => {
    mockGiphyApiKey.getValue.mockResolvedValueOnce("my-custom-key");
    const key = await getGiphyApiKey();
    expect(key).toBe("my-custom-key");
  });

  it("falls back to env default when override is whitespace only", async () => {
    mockGiphyApiKey.getValue.mockResolvedValueOnce("   ");
    const key = await getGiphyApiKey();
    expect(key).toBe("env-default-giphy-key");
  });

  it("returns empty string when no override and no env default are set", async () => {
    vi.stubEnv("WXT_GIPHY_API_KEY", "");
    mockGiphyApiKey.getValue.mockResolvedValueOnce("");
    const key = await getGiphyApiKey();
    expect(key).toBe("");
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("search", () => {
  it("returns mapped GiphySearchResult on success", async () => {
    mockFetchSuccess([makeGiphyGifItem("gif1"), makeGiphyGifItem("gif2")], {
      total_count: 2,
      offset: 0,
    });

    const result = await search("cats");
    expect(result.gifs).toHaveLength(2);
    expect(result.gifs[0].id).toBe("gif1");
    expect(result.gifs[0].title).toBe("GIF gif1");
    expect(result.totalCount).toBe(2);
    expect(result.offset).toBe(0);
  });

  it("uses default limit=20 and offset=0", async () => {
    mockFetchSuccess([]);
    await search("dogs");

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=0");
  });

  it("respects custom limit and offset options", async () => {
    mockFetchSuccess([]);
    await search("dogs", { limit: 10, offset: 20 });

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=20");
  });

  it("includes the rating=g parameter", async () => {
    mockFetchSuccess([]);
    await search("dogs");

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("rating=g");
  });

  it("returns empty result on empty data without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: null, pagination: {} }),
    });

    const result = await search("empty");
    expect(result.gifs).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("throws GiphyAuthError on 403", async () => {
    mockFetchError(403);
    await expect(search("cats")).rejects.toThrow(GiphyAuthError);
    expect(captureError).toHaveBeenCalled();
  });

  it("throws GiphyRateLimitError on 429", async () => {
    mockFetchError(429);
    await expect(search("cats")).rejects.toThrow(GiphyRateLimitError);
    expect(captureError).toHaveBeenCalled();
  });

  it("throws GiphyNetworkError on other HTTP errors", async () => {
    mockFetchError(500);
    await expect(search("cats")).rejects.toThrow(GiphyNetworkError);
    expect(captureError).toHaveBeenCalled();
  });

  it("throws GiphyNetworkError on fetch network failure", async () => {
    mockFetchNetworkError();
    await expect(search("cats")).rejects.toThrow(GiphyNetworkError);
    expect(captureError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// trending
// ---------------------------------------------------------------------------

describe("trending", () => {
  it("returns trending GIFs on success", async () => {
    mockFetchSuccess([makeGiphyGifItem("trend1")], {
      total_count: 1,
      offset: 0,
    });

    const result = await trending();
    expect(result.gifs).toHaveLength(1);
    expect(result.gifs[0].id).toBe("trend1");
  });

  it("calls the trending endpoint (not search)", async () => {
    mockFetchSuccess([]);
    await trending();

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/trending");
    expect(url).not.toContain("/search");
  });

  it("throws GiphyAuthError on 403", async () => {
    mockFetchError(403);
    await expect(trending()).rejects.toThrow(GiphyAuthError);
  });

  it("throws GiphyRateLimitError on 429", async () => {
    mockFetchError(429);
    await expect(trending()).rejects.toThrow(GiphyRateLimitError);
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("getById", () => {
  it("returns a GiphyGif on success", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: makeGiphyGifItem("xyz789") }),
    });

    const gif = await getById("xyz789");
    expect(gif).not.toBeNull();
    expect(gif!.id).toBe("xyz789");
  });

  it("returns null on 404", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    const result = await getById("missing-id");
    expect(result).toBeNull();
  });

  it("returns null when data is empty", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: null }),
    });

    const result = await getById("empty");
    expect(result).toBeNull();
  });

  it("throws GiphyAuthError on 403", async () => {
    mockFetchError(403);
    await expect(getById("id")).rejects.toThrow(GiphyAuthError);
  });

  it("throws GiphyRateLimitError on 429", async () => {
    mockFetchError(429);
    await expect(getById("id")).rejects.toThrow(GiphyRateLimitError);
  });
});

// ---------------------------------------------------------------------------
// Error class names
// ---------------------------------------------------------------------------

describe("error class names", () => {
  it("GiphyNetworkError has correct name", () => {
    expect(new GiphyNetworkError("test").name).toBe("GiphyNetworkError");
  });

  it("GiphyRateLimitError has correct name", () => {
    expect(new GiphyRateLimitError().name).toBe("GiphyRateLimitError");
  });

  it("GiphyAuthError has correct name", () => {
    expect(new GiphyAuthError().name).toBe("GiphyAuthError");
  });
});
