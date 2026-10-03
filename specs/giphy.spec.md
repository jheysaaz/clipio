# Module: Giphy

> Source: `src/lib/giphy.ts`
> Coverage target: 85%

## Purpose

Searches Giphy for GIFs to insert into snippets.

## Scope

**In scope:** Giphy API integration.
**Out of scope:** UI for GIF selection, snippet insertion.

---

## `search(query: string, opts?: SearchOptions): Promise<GiphySearchResult>`

**Behavior:**

- Calls the Giphy API with the API key from `getGiphyApiKey()`.
- `opts.limit` defaults to 20; `opts.offset` defaults to 0.
- Returns a `GiphySearchResult`, which carries paging metadata alongside the GIF
  list — not a bare array.
- `GiphyNetworkError` / `GiphyRateLimitError` are thrown on failure rather than
  resolved to an empty list, so a caller can distinguish "no results" from
  "the request failed".

> **Corrected.** This section previously read `searchGiphy(query, limit?)`
> returning `Promise<GiphyResult[]>` and resolving to `[]` on error. Neither the
> name, the options shape, the return shape, nor the error behaviour matched the
> implementation. Found by the drift gate in
> `specs/coverage-honesty.spec.md`.

---

## `GiphyResult` Type

```ts
interface GiphyResult {
  id: string;
  url: string;
  previewUrl: string;
  title: string;
}
```

---

## Error Handling

- Returns empty array on failure.
- Throws a **typed** error rather than returning an empty list. `search()` rejects with
  `GiphyAuthError` when no API key is configured, `GiphyRateLimitError` on HTTP 429, and
  `GiphyNetworkError` on any other failure. Callers are expected to catch and handle these —
  `giphy.test.ts` asserts all three with `rejects.toThrow`. An earlier revision of this spec
  said "returns `[]`, never throw", which contradicted both the implementation and its tests.

---

## Dependencies

- Giphy API.
- Environment variable for API key.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
