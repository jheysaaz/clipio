# Spec: Image Picker

## Goal

Replace the current `/image` slash command behaviour (which immediately opens the
OS file dialog) with a floating picker panel that shows all images already stored
in IndexedDB. The picker lets the user either **select an existing image** (inserts
it into the editor without a new upload) or **upload a new image** from disk or via
drag-and-drop.

---

## Background

The GIF picker (`GifPicker.tsx`) is the reference UI pattern. The Image Picker
follows the same floating-panel, positioning and keyboard-interaction conventions
so the two features feel consistent.

---

## Trigger

- **Slash command** (`/image`): opens the Image Picker anchored to the cursor
  position (same anchor mechanism as the GIF picker).
- The floating toolbar's **Image button** continues to open the OS file dialog
  directly (unchanged behaviour — no picker for the toolbar path).

---

## Layout & Dimensions

```
┌─────────────────────────────┐  ← w-72 (288 px), fixed-position floating
│ 🔍 Search images…       [×] │  ← search bar + clear button
├─────────────────────────────┤
│  ╔══════╗  ╔══════════════╗ │  ← masonry 2-column (columns-2 gap-1 space-y-1)
│  ║  +   ║  ║  <img>       ║ │
│  ║Upload║  ║              ║ │  ← aspect-ratio preserved per image
│  ╚══════╝  ╚══════════════╝ │
│  ╔══════════════╗  ╔══════╗ │
│  ║  <img>       ║  ║<img> ║ │
│  ╚══════════════╝  ╚══════╝ │
│  …                          │
│  [Load more]  (if > 20)     │  ← optional; max 20 shown initially
└─────────────────────────────┘
│ Drop image here to upload   │  ← dragover hint (shown only during drag)
└─────────────────────────────┘
```

- **Max height**: `max-h-[min(360px,80vh)]`, `overflow-y-auto`
- **Positioning**: `useVirtualFloating` anchored to cursor, `placement="bottom-start"`,
  same `flip` + `shift` middleware as GIF picker

---

## Upload Cell (first grid position)

- Always rendered as the first cell in the masonry grid.
- Styling: `border-2 border-dashed border-border rounded-sm` with a `+` icon and
  an i18n label (`editor.imagePicker.upload`).
- `aspect-[1/1]` (square) so it fits naturally in the masonry flow.
- Clicking triggers the hidden `<input type="file">` in `RichTextEditor` (same as
  before — `onUploadNew()` callback).
- After a file is successfully saved, the picker **closes** and the new image is
  inserted into the editor.

---

## Stored Images Grid

- Each cell shows a thumbnail loaded via `getMediaBlob(id)` → `URL.createObjectURL`
  (same pattern as `ImagePlaceholder.tsx`).
- `aspect-ratio` is set from `entry.width / entry.height` (like GIF cells).
- On click → `onSelectImage(id)` → inserts `IMAGE_PLACEHOLDER` node → picker closes.
- `alt` text used as `title` attribute for tooltip accessibility.
- If `listMedia()` returns an empty array → only the Upload cell is shown, plus an
  empty-state message below it: `editor.imagePicker.empty`.

---

## Search

- Text input filters the in-memory list by `entry.alt` (case-insensitive partial
  match).
- Filtering is purely client-side (all metadata is already loaded via `listMedia()`).
- `useDeferredValue` for smooth rendering while typing.
- When the query is non-empty and no images match → show `editor.imagePicker.noResults`.

---

## Drag-and-Drop

- The picker panel body acts as a drop zone.
- `dragover` event: adds a visual ring (`ring-2 ring-primary`) and shows a
  `editor.imagePicker.dropHint` overlay label.
- `drop` event:
  1. `preventDefault()`
  2. Extract first `File` with `event.dataTransfer.files[0]`.
  3. Validate MIME type client-side (show inline error if unsupported).
  4. Call `onUploadNew(file)` — the same `handleFileSelected` flow in
     `RichTextEditor`.
  5. Close picker, insert image node.

---

## Keyboard

- **Escape**: close picker.
- **Arrow keys / Tab**: not required in v1 (mouse-first interaction).
- Focus on search input on mount (same as GIF picker).

---

## Close Behaviour

- Click outside the panel → close.
- Escape → close.
- Selecting an image → close.
- Uploading a new image (file selected or dropped) → close (after successful save).

---

## Component Interface

```ts
interface ImagePickerProps {
  onSelectImage: (mediaId: string) => void;
  onUploadNew: (file?: File) => void; // undefined = trigger file dialog
  onClose: () => void;
  targetRange: TRange | null;
  manualTrigger?: boolean;
}
```

---

## SlashCommandMenu Change

`onInsertImage` (direct file dialog) is **renamed** to `onOpenImagePicker` in the
slash command handler. The `SlashCommandMenuProps` interface gains `onOpenImagePicker`
while keeping `onInsertImage` for the floating toolbar path.

```ts
// types.ts change
interface SlashCommandMenuProps {
  // ... existing props ...
  onInsertImage: () => void; // kept — used by floating toolbar
  onOpenImagePicker: () => void; // NEW — used by slash command
  // ...
}
```

---

## i18n Keys

| Key                                    | EN                           | ES                             |
| -------------------------------------- | ---------------------------- | ------------------------------ |
| `editor.imagePicker.upload`            | Upload new image             | Subir nueva imagen             |
| `editor.imagePicker.searchPlaceholder` | Search images…               | Buscar imágenes…               |
| `editor.imagePicker.empty`             | No images stored yet.        | Aún no hay imágenes guardadas. |
| `editor.imagePicker.noResults`         | No images match your search. | Ninguna imagen coincide.       |
| `editor.imagePicker.dropHint`          | Drop to upload               | Soltar para subir              |

---

## Acceptance Criteria

### AC-1: Picker opens on `/image` command

Typing `/image` in the editor and pressing Enter (or clicking the command) opens
the Image Picker floating panel anchored near the cursor.

### AC-2: Upload cell is always first

The Upload cell is always the first element in the grid, regardless of how many
stored images exist.

### AC-3: Selecting existing image inserts placeholder and closes

Clicking a stored image inserts an `IMAGE_PLACEHOLDER` node with the correct
`mediaId` and closes the picker.

### AC-4: Upload via Upload cell works

Clicking the Upload cell triggers the file dialog; selecting a file saves it,
inserts the placeholder and closes the picker.

### AC-5: Drag-and-drop uploads and inserts

Dropping an image file onto the picker saves it, inserts the placeholder and
closes the picker.

### AC-6: Search filters by alt text

Entering text in the search bar narrows the grid to images whose `alt` text
contains the query (case-insensitive).

### AC-7: Empty state shows only upload cell

When no images are stored, only the Upload cell and the empty-state message are
shown — no errors, no broken thumbnails.

### AC-8: Escape closes the picker

Pressing Escape while the picker is open closes it without inserting anything.

### AC-9: Click outside closes the picker

Clicking anywhere outside the picker panel closes it.

### AC-10: Floating toolbar path unchanged

The floating toolbar image button still opens the OS file dialog directly (does
not open the picker).
