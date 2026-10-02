/**
 * Pure module for the interface font choice.
 *
 * Kept free of DOM and storage so both the React side (`FontContext`) and the
 * content-script preview palette can read the same stacks without importing
 * each other.
 *
 * spec: specs/ui-font.spec.md
 */

export const UI_FONT_OPTIONS = ["inter", "system", "dyslexic"] as const;

export type UiFont = (typeof UI_FONT_OPTIONS)[number];

/**
 * Inter is the default. It is the font that was already hardcoded across the
 * options page and popup, so for every existing user this setting is a no-op
 * until they touch it.
 */
export const DEFAULT_UI_FONT: UiFont = "inter";

/**
 * The platform UI stack. `system-ui` already resolves to -apple-system on
 * macOS and to Segoe UI on Windows, but the explicit fallbacks are kept because
 * this string is also written into a page's shadow root, where the host page's
 * own font configuration can otherwise leak in between them.
 */
const SYSTEM_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * Every option ends in the system stack on purpose.
 *
 * A family list is not an exclusive choice: the first family that *has* the
 * requested glyph and weight wins. The system tail means a glyph or weight the
 * bundled face lacks falls through to a font that definitely has it, instead of
 * rendering as tofu.
 */
export const UI_FONT_STACKS: Record<UiFont, string> = {
  inter: `InterVariable, ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
  dyslexic: `OpenDyslexic, ${SYSTEM_STACK}`,
};

/** Total. Never throws, whatever it is handed. */
export function isUiFont(value: unknown): value is UiFont {
  return (
    typeof value === "string" &&
    (UI_FONT_OPTIONS as readonly string[]).includes(value)
  );
}

/**
 * Coerces a stored value to a supported option.
 *
 * This is the migration path. The key is new, but `chrome.storage.local` is
 * writable from any extension context and is restored from backups, so the value
 * arriving here is not guaranteed to be one of ours. An unrecognised value
 * becomes the default rather than rendering a select with no selection or a
 * `font-family` that resolves to nothing.
 */
export function normalizeUiFont(value: unknown): UiFont {
  return isUiFont(value) ? value : DEFAULT_UI_FONT;
}

/** The attribute `FontContext` writes, and the key the CSS selectors match. */
export const UI_FONT_ATTRIBUTE = "data-ui-font";

/** The custom property every font-family in the app resolves through. */
export const UI_FONT_VARIABLE = "--font-ui";
