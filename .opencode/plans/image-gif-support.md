# Plan: Image & GIF Support + Fixes

> Branch: `feature/image-gif-support`
> Created: 2026-03-12
> Status: **Planning**

---

## Table of Contents

1. [Overview](#overview)
2. [Decisions Log](#decisions-log)
3. [Phase 0: Branch + Quick Fixes](#phase-0-branch--quick-fixes)
4. [Phase 1: Media Storage Layer (IndexedDB)](#phase-1-media-storage-layer-indexeddb)
5. [Phase 2: Giphy Service](#phase-2-giphy-service)
6. [Phase 3: Editor Types & Plugins](#phase-3-editor-types--plugins)
7. [Phase 4: Serialization Update](#phase-4-serialization-update)
8. [Phase 5: Editor UI Components](#phase-5-editor-ui-components)
9. [Phase 6: Slash Command & Toolbar Integration](#phase-6-slash-command--toolbar-integration)
10. [Phase 7: Content Script Expansion](#phase-7-content-script-expansion)
11. [Phase 8: Snippet Detail View & Copy](#phase-8-snippet-detail-view--copy)
12. [Phase 9: Export with Images (ZIP)](#phase-9-export-with-images-zip)
13. [Phase 10: Import with Images (ZIP)](#phase-10-import-with-images-zip)
14. [Phase 11: Options "Developers" Section](#phase-11-options-developers-section)
15. [Phase 12: "Hide on This Site" Feature](#phase-12-hide-on-this-site-feature)
16. [Phase 13: Manifest & Config Updates](#phase-13-manifest--config-updates)
17. [Error Handling & Sentry Strategy](#error-handling--sentry-strategy)
18. [Known Limitations & Future Work](#known-limitations--future-work)
19. [Execution Checklist](#execution-checklist)

---

## Overview

Add support for **inline images** and **GIFs from Giphy** in Clipio snippets.
Images are stored as compressed WebP blobs in IndexedDB. GIFs are stored as
Giphy ID references (URL-only, no local blob). Both can be inserted via slash
commands (`/image`, `/gif`) and toolbar buttons.

Additionally:

- Fix snippet ordering in sidebar (sort by `updatedAt` descending)
- Default `/` prefix for new snippet shortcuts (including context-menu drafts)
- "Hide on this site" context menu option to disable the extension per-site
- "Developers" section in Options for Giphy API key and blocked sites management
- ZIP export format for snippets with embedded images

---

## Decisions Log

| #   | Decision                 | Chosen                                                      | Alternatives Considered            |
| --- | ------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| 1   | Image use case           | Both inline and standalone                                  | Inline only, standalone only       |
| 2   | GIF provider             | Giphy API                                                   | Tenor, both                        |
| 3   | GIF workflow             | GIF picker in editor (slash + toolbar)                      | Standalone GIF snippets            |
| 4   | Expansion behavior       | Smart: rich (`<img>`) in contenteditable, URL in plain text | Clipboard paste, URL only          |
| 5   | Image size limit         | < 2MB per file                                              | 500KB, 5MB                         |
| 6   | GIF storage              | URL reference only (Giphy ID)                               | Local cache, hybrid TTL            |
| 7   | Giphy API key            | Bundled default + user override in Options                  | Hardcoded, user-only               |
| 8   | Image blob storage       | IndexedDB (dedicated `media` object store)                  | browser.storage.local, external    |
| 9   | Markdown syntax          | `{{image:<id>}}` and `{{gif:<id>}}`                         | Standard `![alt](url)`             |
| 10  | GIF picker placement     | Both `/gif` slash command and toolbar button                | Slash only, toolbar only           |
| 11  | Default shortcut prefix  | `/` (applied to new snippets + context menu drafts)         | No default                         |
| 12  | ZIP library              | `fflate` (~8KB gzipped)                                     | JSZip, custom, CompressionStream   |
| 13  | Blocked sites management | Context menu + Options > Developers                         | General section, context menu only |

---

## Phase 0: Branch + Quick Fixes

### 0a. Create Branch

```bash
git checkout -b feature/image-gif-support
```

### 0b. Fix: Snippet Ordering by `updatedAt` (Newest First)

**Problem:** `filteredSnippets` in `Dashboard.tsx` renders in storage-return order
(insertion order). New snippets appear at the bottom.

**Solution:** Add `.sort()` after `.filter()`:

```ts
// In Dashboard.tsx
const filteredSnippets = snippets
  .filter(/* existing filter */)
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
```

When a snippet is created, `updatedAt = now` -> appears at top.
When a snippet is edited, `updatedAt` is bumped -> floats to top.

**Files:** `src/pages/Dashboard.tsx`

### 0c. Fix: Default `/` Prefix for New Snippet Shortcuts

**Problem:** New snippet draft starts with `shortcut: ""`. Users frequently
type `/` prefix manually.

**Solution:** Change default shortcut to `"/"` in two places:

1. `Dashboard.tsx:handleAddSnippet` -- change `shortcut: ""` to `shortcut: "/"`
2. `Dashboard.tsx:handleCancelCreate` -- change `shortcut: ""` to `shortcut: "/"` (reset)
3. Context-menu draft flow -- when pre-filling from selected text, also set `shortcut: "/"`

**Files:** `src/pages/Dashboard.tsx`

---

## Phase 1: Media Storage Layer (IndexedDB)

**SDD+TDD workflow:** Spec -> Tests -> Implementation

### Spec

**New file:** `specs/media-storage.spec.md`

### Source

**New file:** `src/storage/backends/media.ts`
**Test file:** `src/storage/backends/media.test.ts`
**Modified:** `src/config/constants.ts`, `src/storage/backends/indexeddb.ts` (shared `openDB`)

### Architecture

The current IndexedDB uses DB `"clipio-backup"` v1 with object store `"snippets"`.
We bump to **version 2** and add a `"media"` object store in the `onupgradeneeded`
handler. The existing `openDB()` function in `indexeddb.ts` will be refactored into
a shared module so both `IndexedDBBackend` and `MediaStore` use the same DB connection.

### Data Model

```ts
interface MediaMetadata {
  id: string; // crypto.randomUUID()
  mimeType: string; // "image/webp", "image/png", "image/jpeg", "image/gif"
  width: number;
  height: number;
  size: number; // bytes (after compression)
  originalSize: number; // bytes (before compression)
  createdAt: string; // ISO 8601
}

interface MediaEntry extends MediaMetadata {
  blob: Blob;
}
```

### Public API

| Method                                               | Description                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `saveMedia(file: File \| Blob): Promise<MediaEntry>` | Validate size (< 2MB), read dimensions, generate UUID, store, return entry |
| `getMedia(id: string): Promise<MediaEntry \| null>`  | Retrieve full entry (blob + metadata)                                      |
| `getMediaBlob(id: string): Promise<Blob \| null>`    | Convenience: blob only                                                     |
| `deleteMedia(id: string): Promise<void>`             | Remove entry                                                               |
| `deleteMediaBatch(ids: string[]): Promise<void>`     | Remove multiple entries in one transaction                                 |
| `listMedia(): Promise<MediaMetadata[]>`              | Metadata only (no blobs) for UI listing                                    |
| `getTotalSize(): Promise<number>`                    | Sum all blob sizes                                                         |
| `compressMedia(id: string): Promise<void>`           | Background: compress PNG/JPEG to WebP, update entry                        |

All methods wrapped in try/catch. Failures logged + reported to Sentry. Never throw.

### Compression Strategy

When user uploads PNG/JPEG:

1. Save original blob immediately (fast UX)
2. Fire-and-forget: `compressMedia(id)` runs asynchronously
3. Decode with `createImageBitmap()` -> draw to `OffscreenCanvas` -> `canvas.convertToBlob({ type: "image/webp", quality: 0.85 })`
4. If WebP blob is smaller -> update stored blob, `mimeType`, `size`; keep `originalSize`
5. If WebP is larger (rare for photos, possible for simple graphics) -> keep original
6. GIFs are NEVER compressed (would lose animation; also not stored locally)

### Constants Update

```ts
export const IDB_CONFIG = {
  DB_NAME: "clipio-backup",
  STORE_NAME: "snippets",
  MEDIA_STORE_NAME: "media",
  VERSION: 2,
} as const;

export const MEDIA_LIMITS = {
  MAX_FILE_SIZE: 2 * 1024 * 1024, // 2MB per file
  MAX_TOTAL_SIZE: 50 * 1024 * 1024, // 50MB total
  SUPPORTED_TYPES: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ] as const,
} as const;
```

### DB Migration

In the shared `openDB()`, the `onupgradeneeded` handler checks the old version:

- `oldVersion < 1`: create `"snippets"` store (existing logic)
- `oldVersion < 2`: create `"media"` store with `keyPath: "id"`

This is clean, non-destructive, and handles first-time installs (both stores created)
and upgrades (only `media` store added).

---

## Phase 2: Giphy Service

**SDD+TDD workflow:** Spec -> Tests -> Implementation

### Spec

**New file:** `specs/giphy.spec.md`

### Source

**New file:** `src/lib/giphy.ts`
**Test file:** `src/lib/giphy.test.ts`
**Modified:** `src/storage/items.ts` (new storage item)

### Data Model

```ts
interface GiphyGif {
  id: string;
  title: string;
  previewUrl: string; // fixed_width_small for thumbnails (~100px)
  previewWebpUrl: string; // WebP variant for smaller downloads
  originalUrl: string; // original size for insertion
  width: number; // original dimensions
  height: number;
}

interface GiphySearchResult {
  gifs: GiphyGif[];
  totalCount: number;
  offset: number;
}
```

### Public API

| Method                   | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `search(query, opts?)`   | Search Giphy. `opts: { limit?: number (default 20), offset?: number (default 0) }` |
| `trending(opts?)`        | Trending GIFs. Same opts.                                                          |
| `getById(id)`            | Single GIF by ID. For resolving `{{gif:<id>}}` at render time.                     |
| `getGiphyApiKey()`       | Returns user override if set, else bundled default key.                            |
| `buildGifUrl(id)`        | Pure helper: `https://media.giphy.com/media/${id}/giphy.gif`                       |
| `buildGifPreviewUrl(id)` | Pure helper: `https://media.giphy.com/media/${id}/200w.gif`                        |

### API Key Management

**New storage item in `src/storage/items.ts`:**

```ts
export const giphyApiKeyItem = storage.defineItem<string>("local:giphyApiKey", {
  defaultValue: "",
});
```

- Empty string (`""`) means "use bundled default"
- Bundled default key stored as a constant in `giphy.ts`
- `getGiphyApiKey()` reads from storage, falls back to default

### Error Handling

| Scenario              | Action                                                      |
| --------------------- | ----------------------------------------------------------- |
| Network error         | Throw typed `GiphyNetworkError`, report to Sentry           |
| Rate limited (429)    | Throw typed `GiphyRateLimitError`, report to Sentry         |
| Invalid API key (403) | Throw typed `GiphyAuthError`, report to Sentry, notify user |
| Empty results         | Return empty `gifs: []` (not an error)                      |
| Malformed response    | Catch, report to Sentry, return empty result                |

---

## Phase 3: Editor Types & Plugins

### Modified Files

- `src/components/editor/types.ts`
- `src/components/editor/plugins.ts`

### New Type Constants

```ts
export const IMAGE_PLACEHOLDER = "image_placeholder";
export const GIF_PLACEHOLDER = "gif_placeholder";
```

### New Element Interfaces

```ts
export interface ImagePlaceholderElement extends TElement {
  type: typeof IMAGE_PLACEHOLDER;
  mediaId: string;
}

export interface GifPlaceholderElement extends TElement {
  type: typeof GIF_PLACEHOLDER;
  giphyId: string;
}
```

### New Plugins

```ts
export const ImagePlaceholderPlugin = createPlatePlugin({
  key: IMAGE_PLACEHOLDER,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const GifPlaceholderPlugin = createPlatePlugin({
  key: GIF_PLACEHOLDER,
  node: { isElement: true, isInline: true, isVoid: true },
});
```

### SlashCommandMenu Props Update

```ts
export interface SlashCommandMenuProps {
  // ... existing props ...
  onInsertImage: () => void;
  onInsertGif: () => void;
}
```

---

## Phase 4: Serialization Update

**SDD+TDD workflow:** Update spec -> Write failing tests -> Implement

### Modified Files

- `specs/serialization.spec.md` (update)
- `src/components/editor/serialization.ts`
- `src/components/editor/serialization.test.ts`

### New Placeholder Syntax

| Placeholder | Markdown syntax      | Plate element type                      |
| ----------- | -------------------- | --------------------------------------- |
| Image       | `{{image:<uuid>}}`   | `IMAGE_PLACEHOLDER` with `mediaId` prop |
| GIF         | `{{gif:<giphy-id>}}` | `GIF_PLACEHOLDER` with `giphyId` prop   |

### Serialization Rules

**`serializeToMarkdown`:**

- `IMAGE_PLACEHOLDER` node -> `{{image:<mediaId>}}`
- `GIF_PLACEHOLDER` node -> `{{gif:<giphyId>}}`

**`deserializeFromMarkdown`:**

- Regex `\{\{image:([a-f0-9-]+)\}\}` -> `{ type: IMAGE_PLACEHOLDER, mediaId: "$1", children: [{ text: "" }] }`
- Regex `\{\{gif:([a-zA-Z0-9]+)\}\}` -> `{ type: GIF_PLACEHOLDER, giphyId: "$1", children: [{ text: "" }] }`

**`markdownToHtml`:**

- `{{image:<id>}}` -> `<img data-clipio-media="<id>" alt="image" style="max-width:100%;height:auto;" />`
- `{{gif:<id>}}` -> `<img src="https://media.giphy.com/media/<id>/giphy.gif" alt="GIF" style="max-width:100%;height:auto;" />`

**`markdownToPlainText`:**

- `{{image:<id>}}` -> `[image]`
- `{{gif:<id>}}` -> `[GIF]`

### Round-Trip Invariant

`serializeToMarkdown(deserializeFromMarkdown(md)) === md` for:

- `{{image:550e8400-e29b-41d4-a716-446655440000}}`
- `{{gif:abc123XYZ}}`

---

## Phase 5: Editor UI Components

### New Files

- `src/components/editor/components/placeholders/ImagePlaceholder.tsx`
- `src/components/editor/components/placeholders/GifPlaceholder.tsx`
- `src/components/editor/components/GifPicker.tsx`
- Update `src/components/editor/components/placeholders/index.ts`

### ImagePlaceholder Component

- On mount: `MediaStore.getMediaBlob(mediaId)` -> `URL.createObjectURL(blob)` -> `<img>`
- Loading state: small skeleton/shimmer (matches existing placeholder styling)
- Error state: broken image icon with "Image not found" tooltip
- Cleanup: `URL.revokeObjectURL()` on unmount
- Visual: rounded corners, max-width constrained, subtle border
- Hover: shows file size badge

### GifPlaceholder Component

- Renders `<img src={previewUrl}>` using Giphy URL
- Loading state: skeleton matching GIF aspect ratio
- Error state: "GIF unavailable" placeholder with retry
- "Powered by Giphy" micro-attribution badge (per Giphy TOS)

### GifPicker Component

A floating panel (similar positioning to SlashCommandMenu):

- **Header:** Search input with debounce (300ms)
- **Default state:** Shows trending GIFs (via `GiphyService.trending()`)
- **Search state:** Shows search results (via `GiphyService.search()`)
- **Layout:** 2-column masonry grid of GIF thumbnails
- **Interaction:** Click GIF -> calls `onSelectGif(giphyId)` -> closes picker
- **Pagination:** "Load more" button or infinite scroll
- **Footer:** "Powered by GIPHY" attribution (required by TOS)
- **Error state:** "Failed to load GIFs" with retry button -> error reported to Sentry
- **Keyboard:** Escape closes, Enter selects focused GIF
- **Empty state:** "No GIFs found for '<query>'"

---

## Phase 6: Slash Command & Toolbar Integration

### Modified Files

- `src/components/editor/components/SlashCommandMenu.tsx`
- `src/components/editor/components/FloatingToolbar.tsx`
- `src/components/editor/RichTextEditor.tsx`

### New Slash Commands

| Command  | Icon             | Action                   |
| -------- | ---------------- | ------------------------ |
| `/image` | `Image` (lucide) | Opens native file picker |
| `/gif`   | `Film` (lucide)  | Opens GIF picker panel   |

Added to the `COMMANDS` array after `datepicker`, filtered by `searchQuery`.

### New Toolbar Buttons

Added to `FloatingToolbar.tsx` after the Link button, separated by a `Separator`:

1. **Image** button -- `ImageIcon` from lucide. Triggers hidden `<input type="file" accept="image/*">`.
2. **GIF** button -- `Film` icon (or custom GIF badge). Opens the `GifPicker` panel.

### Image Upload Flow (in RichTextEditor.tsx)

1. File picker opens (triggered by slash command or toolbar button)
2. File selected -> validate:
   - Type in `MEDIA_LIMITS.SUPPORTED_TYPES`? If not -> inline error + Sentry
   - Size <= `MEDIA_LIMITS.MAX_FILE_SIZE`? If not -> inline error + Sentry
   - Total storage <= `MEDIA_LIMITS.MAX_TOTAL_SIZE`? If not -> inline error + Sentry
3. Read dimensions via `createImageBitmap(file)`
4. Save to `MediaStore.saveMedia(file)` -> get `MediaEntry` with `id`
5. Delete slash trigger text (if from slash command)
6. Insert `IMAGE_PLACEHOLDER` node: `{ type: IMAGE_PLACEHOLDER, mediaId: entry.id, children: [{ text: "" }] }`
7. Move cursor past the inserted void element
8. Fire-and-forget: `MediaStore.compressMedia(entry.id)` for background WebP conversion

### GIF Insertion Flow (in RichTextEditor.tsx)

1. GIF picker opens (triggered by slash command or toolbar button)
2. User searches/browses GIFs
3. User clicks a GIF -> `onSelectGif(giphyId)` callback
4. Delete slash trigger text (if from slash command)
5. Insert `GIF_PLACEHOLDER` node: `{ type: GIF_PLACEHOLDER, giphyId, children: [{ text: "" }] }`
6. Move cursor past the inserted void element
7. Close GIF picker

---

## Phase 7: Content Script Expansion

**SDD+TDD workflow:** Update spec -> Write failing tests -> Implement

### Modified Files

- `specs/content-expansion.spec.md` (update)
- `src/lib/content-helpers.ts`
- `src/lib/content-helpers.test.ts`
- `src/entrypoints/content.ts`

### `processSnippetContent` Signature Change

```ts
export function processSnippetContent(
  content: string,
  asHtml: boolean,
  readClipboard: () => string,
  resolveMedia?: (id: string) => string | null, // returns object URL or null
  resolveGif?: (id: string) => string // returns Giphy URL
): ProcessedContent;
```

The new parameters are optional for backwards compatibility. Existing tests
continue to pass without change.

### Expansion Rules

**HTML mode (contenteditable):**

| Placeholder      | Replacement                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `{{image:<id>}}` | `<img src="<objectUrl>" alt="image" style="max-width:100%;height:auto;" />`                                |
| `{{gif:<id>}}`   | `<img src="https://media.giphy.com/media/<id>/giphy.gif" alt="GIF" style="max-width:100%;height:auto;" />` |

- If `resolveMedia(id)` returns `null` -> omit the image (report to Sentry)
- If `resolveGif` is not provided -> use `buildGifUrl(id)` as default

**Plain text mode (input/textarea):**

| Placeholder      | Replacement                                    |
| ---------------- | ---------------------------------------------- |
| `{{image:<id>}}` | `[image]`                                      |
| `{{gif:<id>}}`   | `https://media.giphy.com/media/<id>/giphy.gif` |

### Content Script Changes (`content.ts`)

- Import `MediaStore` from `~/storage/backends/media`
- On snippet expansion:
  - If content contains `{{image:...}}`: open IndexedDB, resolve blob -> `URL.createObjectURL(blob)`
  - Pass `resolveMedia` callback to `processSnippetContentHelper`
  - After insertion: schedule `URL.revokeObjectURL()` cleanup (via `setTimeout`)
- Pass `resolveGif` callback (simple URL builder, no API call needed)

---

## Phase 8: Snippet Detail View & Copy

### Modified Files

- `src/components/SnippetDetailView.tsx`
- `src/components/SnippetListItem.tsx` (preview update)

### Preview Rendering

The detail view preview already renders HTML from markdown. With Phase 4's
`markdownToHtml` changes, `{{image:<id>}}` and `{{gif:<id>}}` will produce
`<img>` tags. However:

- **For images:** The `<img data-clipio-media="<id>">` tags need post-processing
  to inject actual blob URLs. Use a `useEffect` that queries the DOM for
  `[data-clipio-media]` elements, resolves blobs from `MediaStore`, and sets `src`.
- **For GIFs:** The `<img src="giphy-url">` tags work immediately (no post-processing).

### Copy to Clipboard

When copying a snippet containing media:

1. Build HTML with `markdownToHtml`
2. For images: convert blob to base64 data URL and inject into `<img src="data:...">`
   (clipboard HTML needs self-contained images, not blob URLs)
3. For GIFs: the Giphy URL is already in the HTML
4. Write to clipboard with `navigator.clipboard.write(new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': plainBlob }))`
5. Fallback: if media resolution fails -> copy text with `[image]`/`[GIF]` placeholders

### List Item Preview

In `SnippetListItem.tsx`, update `stripMarkdown()` to handle new placeholders:

```ts
text = text.replace(/\{\{image:[a-f0-9-]+\}\}/g, "[image]");
text = text.replace(/\{\{gif:[a-zA-Z0-9]+\}\}/g, "[GIF]");
```

---

## Phase 9: Export with Images (ZIP)

**SDD+TDD workflow:** Update spec -> Write failing tests -> Implement

### Modified Files

- `specs/exporters.spec.md` (update)
- `src/lib/exporters/clipio.ts`
- `src/lib/exporters/clipio.test.ts`
- `src/storage/index.ts` (export function update)

### New Dependency

- `fflate` (~8KB gzipped) -- lightweight ZIP creation/extraction

### Export Format v2

**Backwards compatible:** The `ClipioExport` interface is extended:

```ts
interface ClipioExport {
  version: 1 | 2;
  format: "clipio";
  exportedAt: string;
  snippets: Snippet[];
  media?: MediaMetadata[]; // v2 only
}
```

**Decision logic:**

| Condition                            | Output Format                     | File Extension |
| ------------------------------------ | --------------------------------- | -------------- |
| No snippets contain `{{image:...}}`  | JSON (v1, same as today)          | `.json`        |
| Any snippet contains `{{image:...}}` | ZIP containing JSON + media blobs | `.clipio.zip`  |

**ZIP structure:**

```
export.json            <-- ClipioExport v2 envelope (version: 2, media: [...])
media/
  <uuid>.webp          <-- image blobs by ID
  <uuid>.png
  ...
```

- GIFs are NOT included in the ZIP (they're just Giphy IDs, URL is reconstructed)
- `media[]` array contains metadata for all images referenced in snippets
- Orphaned media (not referenced by any snippet) is NOT exported

### New Functions

```ts
// Existing (unchanged for v1 compat)
buildClipioExport(snippets: Snippet[]): ClipioExport

// New: build v2 with media metadata
buildClipioExportV2(snippets: Snippet[], media: MediaMetadata[]): ClipioExport

// New: create ZIP blob
buildClipioZip(exportData: ClipioExport, mediaBlobs: Map<string, Blob>): Promise<Blob>

// New: detect if snippets have images
snippetsContainMedia(snippets: Snippet[]): boolean
```

### `exportSnippets` Flow (in storage/index.ts)

1. Get all snippets
2. Check `snippetsContainMedia(snippets)`
3. If no images -> `buildClipioExport(snippets)` -> download `.json` (unchanged)
4. If images:
   a. Collect all `{{image:<id>}}` references from snippet content
   b. Fetch each blob from `MediaStore`
   c. Build `ClipioExport` v2 with `media` metadata array
   d. `buildClipioZip(export, blobs)` -> download `.clipio.zip`

---

## Phase 10: Import with Images (ZIP)

### Modified Files

- `src/lib/importers/clipio.ts`
- `src/lib/importers/detect.ts`
- `src/components/ImportWizard.tsx`

### Import Flow

**File detection:**

| File Type              | Handler                            |
| ---------------------- | ---------------------------------- |
| `.json`                | Existing JSON importer (v1 compat) |
| `.zip` / `.clipio.zip` | New ZIP importer                   |

**ZIP import steps:**

1. Read ZIP with `fflate.unzipSync()` or async variant
2. Extract `export.json` -> parse as `ClipioExport`
3. If `version === 2` and `media` array exists:
   a. For each `media` entry, read `media/<id>.<ext>` from ZIP
   b. Save each blob to `MediaStore.saveMedia()`
   c. Map old IDs to new IDs if needed (collision handling)
4. Import snippets via existing flow (conflict resolution etc.)
5. If a media file is missing from the ZIP -> warn but don't fail

### ImportWizard Changes

- Accept `.zip` files in addition to `.json` in the file input
- Update drop zone text: "Drop a JSON or ZIP file here"
- Show media count in the confirm step: "X snippets + Y images"
- If ZIP import contains images that fail to save -> show warning inline

---

## Phase 11: Options "Developers" Section

### Modified Files

- `src/pages/OptionsPage.tsx`
- `src/storage/items.ts`
- `src/locales/en.yml`
- `src/locales/es.yml`

### Navigation Update

```ts
type NavSection =
  | "general"
  | "import-export"
  | "appearance"
  | "developers"
  | "feedback";
```

New nav item between "Appearance" and "Feedback":

- Icon: `Code` (lucide)
- Label: "Developers" / "Desarrolladores"
- Hash: `#developers`

### Section Contents

#### Giphy API Key

- **Title:** "Giphy API Key"
- **Description:** "Override the default Giphy API key with your own. Leave empty to use the bundled key."
- **Input:** Text field (type: password, masked), shows current value (masked)
- **Actions:** "Save" button, "Reset to default" button
- **Storage:** `giphyApiKeyItem`

#### Blocked Sites (Phase 12)

- **Title:** "Blocked Sites"
- **Description:** "Clipio snippet expansion is disabled on these sites. You can block a site from the right-click menu."
- **List:** Each blocked hostname with a "Remove" (X) button
- **Empty state:** "No sites blocked. Right-click on any page -> Clipio -> Hide on this site."
- **Storage:** `blockedSitesItem`

### New i18n Keys

**English (`en.yml`):**

```yaml
options:
  nav:
    developers: Developers
  developers:
    title: Developers
    description: Advanced settings for power users and developers.
    giphyApiKey:
      title: Giphy API Key
      description: Override the default Giphy API key with your own. Leave empty to use the bundled key.
      placeholder: Enter your Giphy API key
      reset: Reset to default
      saved: API key saved
    blockedSites:
      title: Blocked Sites
      description: Clipio snippet expansion is disabled on these sites.
      empty: "No sites blocked. Right-click on any page -> Clipio -> Hide on this site."
      remove: Remove
      removed: Site removed from blocklist
```

**Spanish (`es.yml`):**

```yaml
options:
  nav:
    developers: Desarrolladores
  developers:
    title: Desarrolladores
    description: Configuraciones avanzadas para usuarios avanzados y desarrolladores.
    giphyApiKey:
      title: Clave API de Giphy
      description: Reemplaza la clave API de Giphy predeterminada con la tuya. Deja vacio para usar la clave incluida.
      placeholder: Introduce tu clave API de Giphy
      reset: Restablecer valor predeterminado
      saved: Clave API guardada
    blockedSites:
      title: Sitios bloqueados
      description: La expansion de fragmentos de Clipio esta desactivada en estos sitios.
      empty: "No hay sitios bloqueados. Haz clic derecho en cualquier pagina -> Clipio -> Ocultar en este sitio."
      remove: Eliminar
      removed: Sitio eliminado de la lista de bloqueo
```

---

## Phase 12: "Hide on This Site" Feature

### Overview

Adds a context menu item "Hide on this site" that disables Clipio's snippet
expansion on the current hostname. The blocklist is manageable in Options > Developers.

### Modified Files

- `src/config/constants.ts` (new context menu ID)
- `src/entrypoints/background.ts` (new menu item + handler)
- `src/entrypoints/content.ts` (check blocklist before expansion)
- `src/storage/items.ts` (new storage item)
- `src/locales/en.yml`, `src/locales/es.yml`

### Context Menu Layout

```
Clipio
  |- Save selection as snippet     (on selection)
  |- Create new snippet            (on page/editable)
  |- Open Clipio                   (on page/selection/editable)
  |- Give feedback                 (on page/selection/editable)
  |- ---------- (separator) ----------
  |- Hide on this site             (on page/selection/editable)
```

The separator is achieved using `browser.contextMenus.create({ type: "separator" })`.

### Storage Item

```ts
// src/storage/items.ts
export const blockedSitesItem = storage.defineItem<string[]>(
  "local:blockedSites",
  { defaultValue: [] }
);
```

Stores an array of hostnames (e.g., `["github.com", "twitter.com"]`).

### Constants Update

```ts
// src/config/constants.ts
export const CONTEXT_MENU = {
  // ... existing ...
  SEPARATOR_HIDE: "clipio-separator-hide",
  HIDE_ON_SITE: "clipio-hide-on-site",
} as const;
```

### Background Script Changes

**Menu registration (in `onInstalled`):**

```ts
// After GIVE_FEEDBACK...
browser.contextMenus.create({
  id: CONTEXT_MENU.SEPARATOR_HIDE,
  parentId: CONTEXT_MENU.PARENT,
  type: "separator",
  contexts: ["page", "selection", "editable"],
});

browser.contextMenus.create({
  id: CONTEXT_MENU.HIDE_ON_SITE,
  parentId: CONTEXT_MENU.PARENT,
  title: i18n.t("contextMenu.hideOnSite"),
  contexts: ["page", "selection", "editable"],
});
```

**Click handler:**

```ts
case CONTEXT_MENU.HIDE_ON_SITE: {
  const url = info.pageUrl;
  if (!url) return;
  try {
    const hostname = new URL(url).hostname;
    const current = await blockedSitesItem.getValue();
    if (!current.includes(hostname)) {
      await blockedSitesItem.setValue([...current, hostname]);
    }
  } catch (err) {
    captureError(err, { action: "hideOnSite" });
  }
  break;
}
```

### Content Script Changes

In `content.ts:initialize()`, after loading snippets:

1. Read `blockedSitesItem.getValue()`
2. If `window.location.hostname` is in the list -> skip all event listener registration, return early
3. Watch `blockedSitesItem` for changes -> if current hostname gets blocked, remove listeners; if unblocked, re-register

```ts
// Early in initialize()
const blockedSites = await blockedSitesItem.getValue();
if (blockedSites.includes(window.location.hostname)) {
  console.info("[Clipio] Extension hidden on this site");
  return;
}

// Watch for changes
blockedSitesItem.watch((sites: string[]) => {
  if (sites.includes(window.location.hostname)) {
    // Teardown: remove listeners
    teardownListeners();
  }
});
```

### i18n

```yaml
# en.yml
contextMenu:
  hideOnSite: Hide on this site

# es.yml
contextMenu:
  hideOnSite: Ocultar en este sitio
```

---

## Phase 13: Manifest & Config Updates

### Modified Files

- `wxt.config.ts`
- `package.json` (new dependency: `fflate`)

### Manifest Changes

```ts
// wxt.config.ts
permissions: ["storage", "clipboardWrite", "clipboardRead", "contextMenus"],
host_permissions: [
  "https://*.ingest.us.sentry.io/*",
  "https://*.ingest.sentry.io/*",
  "https://api.giphy.com/*",         // NEW: Giphy API
],
```

Note: Giphy media URLs (`media.giphy.com`, `media0-4.giphy.com`) are loaded via
`<img>` tags, which don't require `host_permissions` -- only `fetch()` calls do.

### New Dependency

```bash
pnpm add fflate
```

---

## Error Handling & Sentry Strategy

### Error Reporting

| Context                                   | Action                                              | Sentry Tag                        |
| ----------------------------------------- | --------------------------------------------------- | --------------------------------- |
| Image upload > 2MB                        | Inline error to user, `captureMessage`              | `action: "media.sizeExceeded"`    |
| Image upload unsupported type             | Inline error to user, `captureMessage`              | `action: "media.unsupportedType"` |
| Media storage full (> 50MB)               | Inline error to user, `captureMessage`              | `action: "media.storageFull"`     |
| MediaStore write failure                  | Inline error to user, `captureError`                | `action: "media.save"`            |
| MediaStore read failure                   | Silent (broken image icon), `captureError`          | `action: "media.get"`             |
| Compression failure                       | Silent (keep original), `captureError`              | `action: "media.compress"`        |
| Giphy network error                       | Inline error in GIF picker, `captureError`          | `action: "giphy.search"`          |
| Giphy rate limit (429)                    | Inline error in GIF picker, `captureError`          | `action: "giphy.rateLimit"`       |
| Giphy invalid key (403)                   | Inline error + suggest checking key, `captureError` | `action: "giphy.auth"`            |
| GIF resolution failure (content script)   | Silent (omit GIF), `captureError`                   | `action: "resolveGif"`            |
| Image resolution failure (content script) | Silent (omit image), `captureError`                 | `action: "resolveMedia"`          |
| ZIP export failure                        | Inline error to user, `captureError`                | `action: "export.zip"`            |
| ZIP import - missing media file           | Warning in wizard (non-blocking), `captureMessage`  | `action: "import.missingMedia"`   |
| Hide on site - URL parse failure          | Silent, `captureError`                              | `action: "hideOnSite"`            |

### User-Facing Error Messages

All user-facing error messages go through i18n. New keys added in both `en.yml` and `es.yml`:

```yaml
# en.yml (under a new `media:` namespace)
media:
  errors:
    tooLarge: "Image too large (max 2MB)"
    unsupportedType: "Unsupported image format"
    storageFull: "Media storage full (max 50MB)"
    saveFailed: "Failed to save image"
    loadFailed: "Image not found"
  gif:
    searchFailed: "Failed to load GIFs. Check your connection."
    rateLimited: "Too many requests. Please wait a moment."
    authFailed: "Invalid Giphy API key. Check your key in Settings > Developers."
    noResults: "No GIFs found"
    poweredBy: "Powered by GIPHY"
```

---

## Known Limitations & Future Work

| Limitation                       | Details                                                    | Future Solution                      |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| No cross-device image sync       | Images live in IndexedDB only (not in storage.sync)        | Cloud storage integration            |
| GIFs require internet            | Giphy URL references need network to render                | Optional local GIF caching           |
| Image export increases file size | ZIP can be large with many images                          | Streaming ZIP, image quality options |
| No image editing                 | Can't crop/resize after upload                             | Built-in image editor                |
| No image drag-and-drop           | Images can only be inserted via slash/toolbar              | Drop zone in editor                  |
| Offline GIF search unavailable   | Giphy API requires internet                                | Cache recent searches                |
| `{{image:<id>}}` in sync storage | The markdown reference is tiny but image data isn't synced | N/A -- by design                     |

---

## Execution Checklist

| #   | Phase                        | Status | Spec                               | Tests                     | Implementation                                                      |
| --- | ---------------------------- | ------ | ---------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| 0a  | Create branch                | [ ]    | --                                 | --                        | --                                                                  |
| 0b  | Fix: snippet ordering        | [ ]    | --                                 | --                        | `Dashboard.tsx`                                                     |
| 0c  | Fix: default `/` prefix      | [ ]    | --                                 | --                        | `Dashboard.tsx`                                                     |
| 1   | Media Storage Layer          | [ ]    | `media-storage.spec.md`            | `media.test.ts`           | `media.ts`, `constants.ts`, `indexeddb.ts`                          |
| 2   | Giphy Service                | [ ]    | `giphy.spec.md`                    | `giphy.test.ts`           | `giphy.ts`, `items.ts`                                              |
| 3   | Editor Types & Plugins       | [ ]    | --                                 | --                        | `types.ts`, `plugins.ts`                                            |
| 4   | Serialization                | [ ]    | Update `serialization.spec.md`     | `serialization.test.ts`   | `serialization.ts`                                                  |
| 5   | Editor UI Components         | [ ]    | --                                 | --                        | 3 new components                                                    |
| 6   | Slash Command & Toolbar      | [ ]    | --                                 | --                        | `SlashCommandMenu.tsx`, `FloatingToolbar.tsx`, `RichTextEditor.tsx` |
| 7   | Content Script Expansion     | [ ]    | Update `content-expansion.spec.md` | `content-helpers.test.ts` | `content-helpers.ts`, `content.ts`                                  |
| 8   | Snippet Detail View & Copy   | [ ]    | --                                 | --                        | `SnippetDetailView.tsx`, `SnippetListItem.tsx`                      |
| 9   | Export with Images (ZIP)     | [ ]    | Update `exporters.spec.md`         | `clipio.test.ts`          | `clipio.ts`, `storage/index.ts`                                     |
| 10  | Import with Images (ZIP)     | [ ]    | --                                 | --                        | Importers, `ImportWizard.tsx`                                       |
| 11  | Options "Developers" Section | [ ]    | --                                 | --                        | `OptionsPage.tsx`, `items.ts`, locales                              |
| 12  | "Hide on This Site"          | [ ]    | --                                 | --                        | `background.ts`, `content.ts`, `constants.ts`, `items.ts`, locales  |
| 13  | Manifest & Config            | [ ]    | --                                 | --                        | `wxt.config.ts`, `package.json`                                     |
| --  | Final: run all tests + build | [ ]    | --                                 | --                        | `pnpm test && pnpm build`                                           |

---

## File Change Summary

### New Files (10+)

| File                                                                 | Phase |
| -------------------------------------------------------------------- | ----- |
| `specs/media-storage.spec.md`                                        | 1     |
| `src/storage/backends/media.ts`                                      | 1     |
| `src/storage/backends/media.test.ts`                                 | 1     |
| `specs/giphy.spec.md`                                                | 2     |
| `src/lib/giphy.ts`                                                   | 2     |
| `src/lib/giphy.test.ts`                                              | 2     |
| `src/components/editor/components/placeholders/ImagePlaceholder.tsx` | 5     |
| `src/components/editor/components/placeholders/GifPlaceholder.tsx`   | 5     |
| `src/components/editor/components/GifPicker.tsx`                     | 5     |

### Modified Files (22+)

| File                                                     | Phases            |
| -------------------------------------------------------- | ----------------- |
| `src/pages/Dashboard.tsx`                                | 0b, 0c            |
| `src/config/constants.ts`                                | 1, 12             |
| `src/storage/backends/indexeddb.ts`                      | 1 (shared openDB) |
| `src/storage/items.ts`                                   | 2, 11, 12         |
| `src/components/editor/types.ts`                         | 3                 |
| `src/components/editor/plugins.ts`                       | 3                 |
| `specs/serialization.spec.md`                            | 4                 |
| `src/components/editor/serialization.ts`                 | 4                 |
| `src/components/editor/serialization.test.ts`            | 4                 |
| `src/components/editor/components/placeholders/index.ts` | 5                 |
| `src/components/editor/components/SlashCommandMenu.tsx`  | 6                 |
| `src/components/editor/components/FloatingToolbar.tsx`   | 6                 |
| `src/components/editor/RichTextEditor.tsx`               | 6                 |
| `specs/content-expansion.spec.md`                        | 7                 |
| `src/lib/content-helpers.ts`                             | 7                 |
| `src/lib/content-helpers.test.ts`                        | 7                 |
| `src/entrypoints/content.ts`                             | 7, 12             |
| `src/components/SnippetDetailView.tsx`                   | 8                 |
| `src/components/SnippetListItem.tsx`                     | 8                 |
| `src/lib/exporters/clipio.ts`                            | 9                 |
| `src/lib/exporters/clipio.test.ts`                       | 9                 |
| `src/lib/importers/clipio.ts`                            | 10                |
| `src/lib/importers/detect.ts`                            | 10                |
| `src/components/ImportWizard.tsx`                        | 10                |
| `src/pages/OptionsPage.tsx`                              | 11                |
| `src/locales/en.yml`                                     | 6, 11, 12         |
| `src/locales/es.yml`                                     | 6, 11, 12         |
| `src/entrypoints/background.ts`                          | 12                |
| `wxt.config.ts`                                          | 13                |
| `package.json` / `pnpm-lock.yaml`                        | 13                |
