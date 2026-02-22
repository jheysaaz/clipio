import type { TElement, TRange } from "platejs";

// Placeholder type constants
export const CLIPBOARD_PLACEHOLDER = "clipboard_placeholder";
export const DATE_PLACEHOLDER = "date_placeholder";
export const CURSOR_PLACEHOLDER = "cursor_placeholder";
export const DATEPICKER_PLACEHOLDER = "datepicker_placeholder";

// Date format options
export const DATE_FORMATS = [
  { id: "iso", label: "ISO", example: "2026-02-21", format: "{{date:iso}}" },
  { id: "us", label: "US", example: "02/21/2026", format: "{{date:us}}" },
  { id: "eu", label: "EU", example: "21/02/2026", format: "{{date:eu}}" },
  {
    id: "long",
    label: "Long",
    example: "February 21, 2026",
    format: "{{date:long}}",
  },
  { id: "short", label: "Short", example: "Feb 21", format: "{{date:short}}" },
] as const;

export type DateFormatId = (typeof DATE_FORMATS)[number]["id"];

// Component props
export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export interface RichTextEditorRef {
  openCommandMenu: () => void;
}

export interface SlashCommandMenuProps {
  onInsertClipboard: () => void;
  onInsertDate: (format: string) => void;
  onInsertCursor: () => void;
  onInsertDatepicker: () => void;
  onClose: () => void;
  targetRange: TRange | null;
  searchQuery: string;
  hasCursorPlaceholder: boolean;
  manualTrigger?: boolean;
}

// Element types with custom properties
export interface DatePlaceholderElement extends TElement {
  type: typeof DATE_PLACEHOLDER;
  format?: string;
}

export interface DatepickerPlaceholderElement extends TElement {
  type: typeof DATEPICKER_PLACEHOLDER;
  date?: string;
}
