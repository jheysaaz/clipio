import { createPlatePlugin } from "platejs/react";
import {
  CLIPBOARD_PLACEHOLDER,
  DATE_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  LINK_ELEMENT,
} from "./types";

// Create a plugin for link elements (inline, NOT void — wraps text)
export const LinkPlugin = createPlatePlugin({
  key: LINK_ELEMENT,
  node: {
    isElement: true,
    isInline: true,
    isVoid: false,
  },
});

// Create a plugin for the clipboard placeholder element
export const ClipboardPlaceholderPlugin = createPlatePlugin({
  key: CLIPBOARD_PLACEHOLDER,
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
  },
});

// Create a plugin for the date placeholder element
export const DatePlaceholderPlugin = createPlatePlugin({
  key: DATE_PLACEHOLDER,
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
  },
});

// Create a plugin for the cursor placeholder element
export const CursorPlaceholderPlugin = createPlatePlugin({
  key: CURSOR_PLACEHOLDER,
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
  },
});

// Create a plugin for the date picker placeholder element
export const DatepickerPlaceholderPlugin = createPlatePlugin({
  key: DATEPICKER_PLACEHOLDER,
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
  },
});
