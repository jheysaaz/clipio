/**
 * Giphy API client.
 *
 * Provides typed search, trending, and GIF-by-ID lookups.
 * GIFs are never stored locally — only their Giphy IDs appear in snippet
 * content as {{gif:<id>}} placeholders.
 *
 * API key priority:
 *   1. User override stored in giphyApiKeyItem (Options > Developers)
 *   2. Build-time default key from WXT_GIPHY_API_KEY
 */

import { captureError } from "~/lib/sentry";
import { giphyApiKeyItem } from "~/storage/items";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default Giphy API key from environment.
 * Users can override this in Options > Developers with their own key.
 *
 * Evaluated lazily at call time (not module-load time) so that tests can
 * override it via vi.stubEnv("WXT_GIPHY_API_KEY", ...) before the first call.
 */
function getDefaultApiKey(): string {
  return (
    (import.meta.env.WXT_GIPHY_API_KEY as string | undefined)?.trim() ?? ""
  );
}

const GIPHY_BASE_URL = "https://api.giphy.com/v1/gifs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GiphyGif {
  id: string;
  title: string;
  /** fixed_width_small thumbnail (~100px wide) */
  previewUrl: string;
  /** WebP variant for smaller downloads */
  previewWebpUrl: string;
  /** Original full-size URL for insertion */
  originalUrl: string;
  width: number;
  height: number;
  /** Dimensions of the fixed_width_small preview thumbnail */
  previewWidth: number;
  previewHeight: number;
}

export interface GiphySearchResult {
  gifs: GiphyGif[];
  totalCount: number;
  offset: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class GiphyNetworkError extends Error {
  override name = "GiphyNetworkError" as const;
  constructor(message: string) {
    super(message);
  }
}

export class GiphyRateLimitError extends Error {
  override name = "GiphyRateLimitError" as const;
  constructor(message = "Giphy rate limit exceeded") {
    super(message);
  }
}

export class GiphyAuthError extends Error {
  override name = "GiphyAuthError" as const;
  constructor(message = "Invalid Giphy API key") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Retrieve the active Giphy API key (user override or bundled default). */
export async function getGiphyApiKey(): Promise<string> {
  try {
    const override = await giphyApiKeyItem.getValue();
    if (override && override.trim().length > 0) return override.trim();
  } catch {
    // Fall through to default
  }
  return getDefaultApiKey();
}

/** Pure helper: build the full-size animated GIF URL for a given Giphy ID. */
export function buildGifUrl(id: string): string {
  return `https://media.giphy.com/media/${id}/giphy.gif`;
}

/** Pure helper: build the 200px-wide preview GIF URL for a given Giphy ID. */
export function buildGifPreviewUrl(id: string): string {
  return `https://media.giphy.com/media/${id}/200w.gif`;
}

/** Map a single Giphy API GIF object to our typed GiphyGif. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGif(item: Record<string, any>): GiphyGif {
  const images = item.images ?? {};
  const fixedSmall = images.fixed_width_small ?? {};
  const original = images.original ?? {};

  return {
    id: item.id ?? "",
    title: item.title ?? "",
    previewUrl: fixedSmall.url ?? buildGifPreviewUrl(item.id),
    previewWebpUrl:
      fixedSmall.webp ?? fixedSmall.url ?? buildGifPreviewUrl(item.id),
    originalUrl: original.url ?? buildGifUrl(item.id),
    width: parseInt(original.width ?? "0", 10),
    height: parseInt(original.height ?? "0", 10),
    previewWidth: parseInt(fixedSmall.width ?? "100", 10),
    previewHeight: parseInt(fixedSmall.height ?? "100", 10),
  };
}

/** Check a fetch Response for API-level errors and throw typed errors. */
async function assertResponse(
  response: Response,
  action: string
): Promise<void> {
  if (response.ok) return;

  if (response.status === 403) {
    const err = new GiphyAuthError();
    captureError(err, { action: "giphy.auth" });
    throw err;
  }
  if (response.status === 429) {
    const err = new GiphyRateLimitError();
    captureError(err, { action: "giphy.rateLimit" });
    throw err;
  }
  const err = new GiphyNetworkError(
    `Giphy ${action} failed: HTTP ${response.status}`
  );
  captureError(err, { action });
  throw err;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search Giphy for GIFs matching the given query.
 */
export async function search(
  query: string,
  opts: SearchOptions = {}
): Promise<GiphySearchResult> {
  const { limit = 20, offset = 0 } = opts;
  const apiKey = await getGiphyApiKey();

  const url = new URL(`${GIPHY_BASE_URL}/search`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("rating", "g");

  try {
    const response = await fetch(url.toString());
    await assertResponse(response, "giphy.search");
    const json = await response.json();
    const data = Array.isArray(json.data) ? json.data : [];
    const pagination = json.pagination ?? {};
    return {
      gifs: data.map(mapGif),
      totalCount: pagination.total_count ?? 0,
      offset: pagination.offset ?? 0,
    };
  } catch (err) {
    if (
      err instanceof GiphyAuthError ||
      err instanceof GiphyRateLimitError ||
      err instanceof GiphyNetworkError
    ) {
      throw err;
    }
    const wrapped = new GiphyNetworkError(
      err instanceof Error ? err.message : "Unknown network error"
    );
    captureError(wrapped, { action: "giphy.search" });
    throw wrapped;
  }
}

/**
 * Fetch trending GIFs from Giphy.
 */
export async function trending(
  opts: SearchOptions = {}
): Promise<GiphySearchResult> {
  const { limit = 20, offset = 0 } = opts;
  const apiKey = await getGiphyApiKey();

  const url = new URL(`${GIPHY_BASE_URL}/trending`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("rating", "g");

  try {
    const response = await fetch(url.toString());
    await assertResponse(response, "giphy.trending");
    const json = await response.json();
    const data = Array.isArray(json.data) ? json.data : [];
    const pagination = json.pagination ?? {};
    return {
      gifs: data.map(mapGif),
      totalCount: pagination.total_count ?? 0,
      offset: pagination.offset ?? 0,
    };
  } catch (err) {
    if (
      err instanceof GiphyAuthError ||
      err instanceof GiphyRateLimitError ||
      err instanceof GiphyNetworkError
    ) {
      throw err;
    }
    const wrapped = new GiphyNetworkError(
      err instanceof Error ? err.message : "Unknown network error"
    );
    captureError(wrapped, { action: "giphy.trending" });
    throw wrapped;
  }
}

/**
 * Fetch a single GIF by its Giphy ID.
 * Used when expanding {{gif:<id>}} at render time to get full metadata.
 * Returns null for 404 or empty data.
 */
export async function getById(id: string): Promise<GiphyGif | null> {
  const apiKey = await getGiphyApiKey();

  const url = new URL(`${GIPHY_BASE_URL}/${id}`);
  url.searchParams.set("api_key", apiKey);

  try {
    const response = await fetch(url.toString());

    if (response.status === 404) return null;
    await assertResponse(response, "giphy.getById");

    const json = await response.json();
    if (!json.data || !json.data.id) return null;
    return mapGif(json.data);
  } catch (err) {
    if (
      err instanceof GiphyAuthError ||
      err instanceof GiphyRateLimitError ||
      err instanceof GiphyNetworkError
    ) {
      throw err;
    }
    const wrapped = new GiphyNetworkError(
      err instanceof Error ? err.message : "Unknown network error"
    );
    captureError(wrapped, { action: "giphy.getById" });
    throw wrapped;
  }
}
