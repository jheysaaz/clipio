# Module: Giphy Service

> Source: `src/lib/giphy.ts`
> Coverage target: 85%

## Purpose

Provides a typed client for the Giphy API. Used by the GIF picker component
to search and display GIFs in the editor. GIFs are stored as Giphy ID
references only (`{{gif:<id>}}`); no blobs are saved locally.

## Scope

**In scope:** `search`, `trending`, `getById`, `getGiphyApiKey`,
`buildGifUrl`, `buildGifPreviewUrl`, typed error classes.
**Out of scope:** UI rendering, GIF picker state, snippet content parsing.

---

## Data Model

### `GiphyGif`

- MUST have `id: string`
- MUST have `title: string`
- MUST have `previewUrl: string` (fixed_width_small thumbnail, ~100px wide)
- MUST have `previewWebpUrl: string` (WebP variant for smaller downloads)
- MUST have `originalUrl: string` (original size for insertion)
- MUST have `width: number` (original dimensions)
- MUST have `height: number`

### `GiphySearchResult`

- MUST have `gifs: GiphyGif[]`
- MUST have `totalCount: number`
- MUST have `offset: number`

---

## Error Classes

### `GiphyNetworkError`

- MUST extend `Error`
- MUST have `name === "GiphyNetworkError"`

### `GiphyRateLimitError`

- MUST extend `Error`
- MUST have `name === "GiphyRateLimitError"`

### `GiphyAuthError`

- MUST extend `Error`
- MUST have `name === "GiphyAuthError"`

---

## `getGiphyApiKey(): Promise<string>`

**Behavior:**

- MUST return the user-configured API key from `giphyApiKeyItem` if set
  (non-empty string).
- MUST return the bundled default API key constant when the stored value is
  empty or null.

---

## `buildGifUrl(id: string): string`

**Behavior:**

- MUST return `https://media.giphy.com/media/${id}/giphy.gif`
- MUST be a pure function (no side effects, no async).

---

## `buildGifPreviewUrl(id: string): string`

**Behavior:**

- MUST return `https://media.giphy.com/media/${id}/200w.gif`
- MUST be a pure function.

---

## `search(query: string, opts?: SearchOptions): Promise<GiphySearchResult>`

Where `SearchOptions = { limit?: number; offset?: number }`.

**Behavior:**

- MUST call the Giphy search endpoint:
  `https://api.giphy.com/v1/gifs/search?api_key=<key>&q=<query>&limit=<limit>&offset=<offset>&rating=g`
- MUST default `limit` to `20` if not provided.
- MUST default `offset` to `0` if not provided.
- MUST map the response to `GiphySearchResult` with `gifs`, `totalCount`,
  and `offset` fields.
- MUST map each GIF item to `GiphyGif` using the correct Giphy response fields.
- MUST return `{ gifs: [], totalCount: 0, offset: 0 }` on an empty or
  malformed response without throwing.
- MUST throw `GiphyAuthError` (and report to Sentry with tag
  `action: "giphy.auth"`) when the API responds with HTTP 403.
- MUST throw `GiphyRateLimitError` (and report to Sentry with tag
  `action: "giphy.rateLimit"`) when the API responds with HTTP 429.
- MUST throw `GiphyNetworkError` (and report to Sentry with tag
  `action: "giphy.search"`) on any other non-ok HTTP response or network error.

---

## `trending(opts?: SearchOptions): Promise<GiphySearchResult>`

**Behavior:**

- MUST call the Giphy trending endpoint:
  `https://api.giphy.com/v1/gifs/trending?api_key=<key>&limit=<limit>&offset=<offset>&rating=g`
- MUST follow the same success/error rules as `search`.

---

## `getById(id: string): Promise<GiphyGif | null>`

**Behavior:**

- MUST call the Giphy GIF-by-ID endpoint:
  `https://api.giphy.com/v1/gifs/${id}?api_key=<key>`
- MUST return a single `GiphyGif` on success.
- MUST return `null` if the API returns a 404 or empty `data`.
- MUST throw `GiphyAuthError` on 403, `GiphyRateLimitError` on 429,
  `GiphyNetworkError` on other errors.
