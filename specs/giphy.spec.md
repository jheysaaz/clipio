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
- Does not throw.

---

## Dependencies

- Giphy API.
- Environment variable for API key.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |