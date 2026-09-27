# Module: Giphy

> Source: `src/lib/giphy.ts`
> Coverage target: 85%

## Purpose

Searches Giphy for GIFs to insert into snippets.

## Scope

**In scope:** Giphy API integration.
**Out of scope:** UI for GIF selection, snippet insertion.

---

## `searchGiphy(query: string, limit?: number): Promise<GiphyResult[]>`

**Behavior:**

- Calls Giphy API with API key from env.
- Returns array of `{ id, url, previewUrl, title }`.
- Returns `[]` on network error or invalid response.
- Pure function aside from fetch.

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
