/**
 * Theme and interface-font state, as a store.
 *
 * Replaces `src/hooks/ThemeContext.tsx` and `src/hooks/FontContext.tsx`.
 *
 * ── Why a store rather than a context ──────────────────────────────────────
 *
 * The two providers disagreed about what they were. `ThemeProvider` was a real
 * context, so every component beneath it re-rendered whenever the theme
 * changed. `FontProvider` deliberately was **not** a context — its own comment
 * said so — because nothing reads the font, it just needs painting, and a
 * provider would re-render the whole options page for a change no component
 * renders.
 *
 * A store satisfies both without the compromise. Components subscribe to exactly
 * the slice they read, so a font change re-renders nobody; the DOM writes live
 * here as effects rather than in a provider's `useEffect`; and there is no
 * provider to wrap the tree in, so a component cannot read a setting from
 * outside a provider by mistake.
 *
 * The module has import side effects — it loads from storage and paints the
 * document on import. That is deliberate, and matches `src/lib/sentry.ts`, whose
 * `init` also runs on import. Both `main.tsx` files import it for that reason.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import {
  legacyThemeItem,
  themeModeItem,
  uiFontItem,
  type ThemeMode,
} from "@/storage/items";
import { UI_FONT_ATTRIBUTE, normalizeUiFont, type UiFont } from "@/lib/ui-font";
import { captureError } from "@/lib/sentry";
import { effectOn } from "./effect";

export type { ThemeMode };

type ResolvedTheme = "light" | "dark";

export type SettingsState = {
  /**
   * The user's selection; `"system"` defers to the OS.
   *
   * Starts at `"system"` so the first paint is sane. `isLoaded` is what says
   * whether it can be trusted yet.
   */
  themeMode: ThemeMode;
  /** `"system"` resolved against the OS preference. */
  resolvedTheme: ResolvedTheme;
  /**
   * Whether the persisted values have been read.
   *
   * Separate from `themeMode` because persistence runs off changes: without
   * this flag the store would write the initial `"system"` default straight over
   * a saved `"dark"` before the read landed. That is the bug this field exists
   * to prevent.
   */
  isLoaded: boolean;
  /** The interface font, normalised to a supported value. */
  uiFont: UiFont;
};

/** Reads the OS colour-scheme preference. */
function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

export const settingsStore = createStore<SettingsState>({
  themeMode: "system",
  resolvedTheme: "light",
  isLoaded: false,
  uiFont: normalizeUiFont(undefined),
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * The stored mode, falling back to the pre-three-mode `theme` key.
 *
 * ── Why this reads storage directly ─────────────────────────────────────────
 *
 * The previous version asked `themeModeItem.getValue()` and fell through to the
 * legacy key when it returned something unexpected. That branch was **dead**:
 * the item is declared with `defaultValue: "system"`, so an absent key resolves
 * to `"system"` rather than to anything the guard would reject. A user upgrading
 * from a build that only ever wrote `local:theme` therefore silently lost their
 * saved dark preference and was put back on "follow the OS" — the migration this
 * function exists to perform never happened for anyone.
 *
 * Deciding on a *missing* key rather than an unexpected value needs the raw
 * storage read, because the typed item cannot distinguish "absent" from "set to
 * the default". `browser.storage.local.get` can.
 */
async function readThemeMode(): Promise<ThemeMode> {
  const present = await isStored(THEME_MODE_KEY);
  if (present) {
    const saved = await themeModeItem.getValue();
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  }

  const legacy = await legacyThemeItem.getValue();
  return legacy === "light" || legacy === "dark" ? legacy : "system";
}

/**
 * The raw `storage.local` key `themeModeItem` writes to.
 *
 * **Not** `"local:themeMode"`. WXT splits the key on the first colon: the prefix
 * selects the storage *area*, and the remainder is the key inside it. Probed
 * against the installed `@wxt-dev/storage`:
 *
 *     storage.defineItem("local:themeMode").setValue("dark")
 *     // → storage.local.set({ themeMode: "dark" })
 *
 * Reading `"local:themeMode"` back returns `{}` every time, so the presence probe
 * below was permanently false and the store silently resolved `"system"` for
 * everyone — the select would read "Dark" while the page rendered light.
 *
 * Deriving the key rather than restating it here would be better if WXT exposed
 * it. It does not, so this string is the price of the presence check, and
 * `settings.test.ts` pins it against a key-aware mock.
 */
const THEME_MODE_KEY = "themeMode";

/**
 * Whether a key exists in local storage.
 *
 * A key whose stored value is `undefined` counts as absent, which is what
 * `storage.local.set({ key: undefined })` leaves behind and what the extension's
 * own `removeValue` paths produce.
 */
async function isStored(key: string): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(key);
    return result[key] !== undefined && result[key] !== null;
  } catch {
    // A failed presence check must not strand the user on the legacy path when
    // they have a valid modern key. Treat it as present and let the typed read
    // decide.
    return true;
  }
}

async function loadSettings(): Promise<void> {
  try {
    const [mode, font] = await Promise.all([
      readThemeMode(),
      uiFontItem.getValue(),
    ]);
    const normalized = normalizeUiFont(font);
    settingsStore.setState((prev) => ({
      ...prev,
      themeMode: mode,
      resolvedTheme: resolveTheme(mode),
      isLoaded: true,
      uiFont: normalized,
    }));

    // Self-heal a corrupt font: storage can hold a value from a hand edit, a
    // restored backup, or a build with different options. Writing the
    // normalisation back means it stops being re-read on every page load
    // instead of lingering forever.
    if (normalized !== font) {
      uiFontItem
        .setValue(normalized)
        .catch((error: unknown) =>
          captureError(error, { action: "settings.healFont" })
        );
    }
  } catch (error) {
    // Storage unavailable (extension context invalidated). Keep the defaults,
    // but still mark loaded — otherwise the persist effects stay inert for the
    // rest of the session and the settings silently stop working.
    captureError(error, { action: "settings.load" });
    settingsStore.setState((prev) => ({ ...prev, isLoaded: true }));
  }
}

void loadSettings();

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

effectOn(
  settingsStore,
  ["themeMode", "isLoaded"],
  ({ themeMode, isLoaded }) => {
    if (!isLoaded) return;
    // A storage failure must not stop the theme being applied — it is already
    // painted by the DOM effect below. Warn and carry on, as the old provider did.
    themeModeItem.setValue(themeMode).catch(console.warn);
  }
);

effectOn(settingsStore, ["uiFont", "isLoaded"], ({ uiFont, isLoaded }) => {
  if (!isLoaded) return;
  uiFontItem.setValue(uiFont).catch(console.warn);
});

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

effectOn(
  settingsStore,
  ["resolvedTheme", "isLoaded"],
  ({ resolvedTheme, isLoaded }) => {
    if (!isLoaded) return;
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }
);

/**
 * Paint the interface font.
 *
 * Painted only after the read resolves, so until then the document keeps
 * whatever `--font-ui` declares by default (Inter) — no flash of a wrong font,
 * only a brief moment of the default for a non-Inter user.
 */
effectOn(settingsStore, ["uiFont", "isLoaded"], ({ uiFont, isLoaded }) => {
  if (!isLoaded) return;
  document.documentElement.setAttribute(UI_FONT_ATTRIBUTE, uiFont);
});

/**
 * Follow the OS preference while in system mode.
 *
 * The returned teardown runs when the mode leaves `"system"`, so pinning the
 * theme really does pin it — no stale listener rewriting the class behind the
 * user's back.
 */
effectOn(
  settingsStore,
  ["themeMode", "isLoaded"],
  ({ themeMode, isLoaded }) => {
    if (!isLoaded || themeMode !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      // Only `resolvedTheme` moves; the `resolvedTheme` effect above repaints.
      settingsStore.setState((prev) => ({
        ...prev,
        resolvedTheme: getSystemTheme(),
      }));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
);

/**
 * Keep the painted font in step with a change made in another context.
 *
 * The options page and the popup are separate documents. Changing the font in
 * one writes storage; without this the other keeps the old face until it
 * reloads. `FontProvider` watched for exactly this reason.
 */
// Deliberately not torn down: the store lives as long as the document does, and
// the page going away is what ends it. A `_dispose` export existed here for a
// moment and was unused — an unused teardown is a promise nobody kept.
uiFontItem.watch((stored) => {
  const font = normalizeUiFont(stored);
  if (font === settingsStore.state.uiFont) return;
  settingsStore.setState((prev) => ({ ...prev, uiFont: font }));
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function setThemeMode(mode: ThemeMode): void {
  settingsStore.setState((prev) => ({
    ...prev,
    themeMode: mode,
    resolvedTheme: resolveTheme(mode),
  }));
}

/**
 * Flip between explicit light and dark, leaving system mode.
 *
 * Leaving system mode is the point: with the OS on dark, a toggle that stayed
 * on `"system"` would appear to do nothing.
 */
export function toggleTheme(): void {
  const current = settingsStore.state.themeMode;
  const effective = current === "system" ? getSystemTheme() : current;
  setThemeMode(effective === "light" ? "dark" : "light");
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

/** Subscribe to one slice of the settings store. */
export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

/** The applied theme, for components that branch on it. */
export function useTheme(): ResolvedTheme {
  return useSettings((s) => s.resolvedTheme);
}

/** The user's selection, which may be `"system"`. */
export function useThemeMode(): ThemeMode {
  return useSettings((s) => s.themeMode);
}
