# Module: Image Picker

> Source: `src/components/ImagePicker.tsx`
> Coverage target: 85%

## Purpose

UI component for selecting and inserting images into snippets.

## Scope

**In scope:** Image selection UI, file handling, base64 conversion.
**Out of scope:** Image storage, snippet persistence.

---

## `ImagePicker` Component

**Props:**

```ts
interface ImagePickerProps {
  onSelect: (image: { dataUrl: string; name: string; type: string }) => void;
  onClose: () => void;
}
```

**Behavior:**

- Opens file picker for image files.
- Converts to base64 data URL.
- Calls `onSelect` with image data.
- Calls `onClose` on cancel.

---

## Error Handling

- Handles file read errors gracefully.
- Validates file type.

---

## Dependencies

- React, FileReader API.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |