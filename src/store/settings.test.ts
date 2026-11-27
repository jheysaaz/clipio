/**
 * Tests for the settings store.
 *
 * These are new coverage rather than moved coverage. `src/hooks/**` is on the
 * vitest exclusion list, so `ThemeProvider` and `FontProvider` shipped with no
 * unit tests at all — only e2e assertions that the options page renders. The
 * store is in `src/store/**`, which is measured, so what is covered here is the
 * behaviour that was previously untestable: the legacy-theme fallback, the
 * corrupt-font self-heal, and the guard that stops the store overwriting a saved
 * theme before it has read it.
 *
 * ── Why every test goes through `setup()` ───────────────────────────────────
 *
 * The module loads from storage on import, so a plain top-level import would
 * load once for the whole file and every test would share whatever storage held
 * at that moment. Each test needs its own.
 *
 * It also has to import the storage items from the *same* fresh module registry,
 * after the reset. Resetting modules and then seeding storage through an
 * item imported before the reset writes to a different instance than the store
 * reads — which fails in a way that looks like the store ignoring storage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { CODE_THEME_ATTRIBUTE } from "@/lib/code-theme";
import { UI_FONT_ATTRIBUTE } from "@/lib/ui-font";

import { resetBrowserMocks } from "../../tests/mocks/browser";

/**
 * ── A note on storage in this file ──────────────────────────────────────────
 *
 * `tests/setup.ts` replaces `wxt/utils/storage` globally, and a file-level
 * `vi.mock` for the same path does not reliably take precedence over it — so this
 * suite seeds through the typed items and lets that mock mirror the write to
 * `storage.local`, exactly as the real one does.
 *
 * An earlier version of this file *also* hand-wrote the raw key:
 *
 *     await browser.storage.local.set({ "local:themeMode": preset.theme })
 *
 * That was papering over a real bug. WXT strips the area prefix, so the item
 * writes `themeMode`, not `local:themeMode` — the store's presence probe looked
 * up the wrong key, always missed, and silently resolved `"system"` for every
 * user. The mock now mirrors writes with the correct driver key, and no test here
 * writes a raw storage key by hand, so that class of mistake cannot hide again.
 */

/** Listeners the store registered via `matchMedia`. */
let mediaListeners: Array<(e: unknown) => void> = [];
/** Whether the OS is currently asking for dark. */
let systemPrefersDark = false;

/**
 * `matchMedia` is absent from happy-dom, so system-theme resolution needs one.
 * Every listener registered here stays reachable from `mediaListeners`, which is
 * the only way the "the OS preference changed" path can be driven at all.
 */
function installMatchMedia() {
  mediaListeners = [];
  systemPrefersDark = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? systemPrefersDark : false,
    media: query,
    addEventListener: (_: string, fn: (e: unknown) => void) => {
      mediaListeners.push(fn);
    },
    removeEventListener: (_: string, fn: (e: unknown) => void) => {
      mediaListeners = mediaListeners.filter((l) => l !== fn);
    },
  }));
}

type Preset = {
  theme?: string;
  legacy?: string;
  font?: string;
  lightTheme?: string;
  darkTheme?: string;
  /** Make every read reject, as a torn-down extension context would. */
  breakStorage?: boolean;
};

/**
 * Reset the module registry, seed storage, then import the store.
 *
 * The returned `items` are the same instances the store holds, so a test can
 * write through them and be certain the store will see it.
 */
async function setup(preset: Preset = {}) {
  vi.resetModules();
  const items = await import("@/storage/items");

  // Only ever through the typed items. The mirror to `storage.local` is the
  // mock's job, exactly as it is WXT's — a test that writes a raw key is
  // asserting the mock rather than the code.
  if (preset.theme !== undefined) {
    // `preset.theme` is a `string` because one case seeds an invalid value.
    await writeUntyped(items.themeModeItem, preset.theme);
  } else {
    await items.themeModeItem.removeValue();
  }
  if (preset.legacy !== undefined) {
    await items.legacyThemeItem.setValue(preset.legacy);
  }
  if (preset.font !== undefined) {
    await writeUntyped(items.uiFontItem, preset.font);
  }
  if (preset.lightTheme !== undefined) {
    await writeUntyped(items.lightCodeThemeItem, preset.lightTheme);
  }
  if (preset.darkTheme !== undefined) {
    await writeUntyped(items.darkCodeThemeItem, preset.darkTheme);
  }

  if (preset.breakStorage) {
    vi.spyOn(items.themeModeItem, "getValue").mockRejectedValue(
      new Error("Extension context invalidated")
    );
  }

  const settings = await import("./settings");
  return { ...settings, items, store: settings.settingsStore };
}

/**
 * Write a value the typed item's signature forbids.
 *
 * Three tests here store `"comic-sans"`, `"nonsense"` and `"not-a-font"` on
 * purpose. That is not a type error to work around — it is the situation the
 * self-healing exists for: `storage.local` is writable from any extension
 * context and is restored from backups and sync, so the value arriving at these
 * items is not guaranteed to be one of ours. The typed signature is the thing
 * that is wrong about the situation, not the test.
 */
async function writeUntyped(
  item: { setValue: (v: never) => Promise<void> },
  value: unknown
) {
  await item.setValue(value as never);
}

/** Waits for the store's on-import load to finish. */
async function loaded(store: { state: { isLoaded: boolean } }) {
  await vi.waitFor(() => expect(store.state.isLoaded).toBe(true));
}

const prefersDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  // The shared browser mock keeps storage between tests unless it is told
  // otherwise, and a leftover theme key would make the presence probe answer for
  // a test that meant to start from "unset".
  resetBrowserMocks();
  installMatchMedia();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute(UI_FONT_ATTRIBUTE);
  document.documentElement.removeAttribute(CODE_THEME_ATTRIBUTE);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Actions, which need no storage
// ---------------------------------------------------------------------------

describe("theme actions", () => {
  it("setThemeMode resolves an explicit mode to itself", async () => {
    const { setThemeMode, store } = await setup();
    setThemeMode("dark");
    expect(store.state.themeMode).toBe("dark");
    expect(store.state.resolvedTheme).toBe("dark");
  });

  it("setThemeMode resolves system against a light OS", async () => {
    const { setThemeMode, store } = await setup();
    systemPrefersDark = false;
    setThemeMode("system");
    expect(store.state.resolvedTheme).toBe("light");
  });

  it("setThemeMode resolves system against a dark OS", async () => {
    const { setThemeMode, store } = await setup();
    systemPrefersDark = true;
    setThemeMode("system");
    expect(store.state.resolvedTheme).toBe("dark");
  });

  it("toggleTheme flips light to dark", async () => {
    const { toggleTheme, store } = await setup();
    store.setState((p) => ({ ...p, themeMode: "light" }));

    toggleTheme();
    expect(store.state.themeMode).toBe("dark");
    expect(store.state.resolvedTheme).toBe("dark");
  });

  it("toggleTheme flips dark to light", async () => {
    const { toggleTheme, store } = await setup();
    store.setState((p) => ({ ...p, themeMode: "dark" }));

    toggleTheme();
    expect(store.state.themeMode).toBe("light");
  });

  it("toggleTheme leaves system mode, so it visibly does something", async () => {
    // With the OS on dark, a toggle that stayed on "system" would look broken.
    const { toggleTheme, store } = await setup();
    systemPrefersDark = true;
    store.setState((p) => ({ ...p, themeMode: "system" }));

    toggleTheme();
    expect(store.state.themeMode).toBe("light");
  });

  it("sets each code palette without disturbing the other", async () => {
    const { setLightCodeTheme, setDarkCodeTheme, store } = await setup();

    setLightCodeTheme("solarized-light");
    setDarkCodeTheme("twilight");

    expect(store.state.lightCodeTheme).toBe("solarized-light");
    expect(store.state.darkCodeTheme).toBe("twilight");
  });
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe("loading persisted settings", () => {
  it("adopts a saved dark theme and paints it", async () => {
    const { store } = await setup({ theme: "dark" });
    await loaded(store);

    expect(store.state.themeMode).toBe("dark");
    expect(prefersDark()).toBe(true);
  });

  it("adopts a saved light theme and clears the dark class", async () => {
    document.documentElement.classList.add("dark");
    const { store } = await setup({ theme: "light" });
    await loaded(store);

    expect(prefersDark()).toBe(false);
  });

  it("falls back to the legacy theme key when the mode is unset", async () => {
    // An upgrade from before the three-mode setting must not drop a user who had
    // chosen dark back to following the OS.
    const { store } = await setup({ legacy: "dark" });
    await loaded(store);

    expect(store.state.themeMode).toBe("dark");
  });

  it("defaults to system when neither key holds a usable value", async () => {
    const { store } = await setup({ legacy: "nonsense" });
    await loaded(store);

    expect(store.state.themeMode).toBe("system");
  });

  it("marks loaded even when storage throws, so settings still work", async () => {
    // Otherwise the persist effects stay inert for the rest of the session and
    // the theme silently stops responding to the user.
    const { store } = await setup({ breakStorage: true });
    await loaded(store);

    expect(store.state.isLoaded).toBe(true);
  });

  it("keeps the defaults when storage throws, rather than leaving nothing painted", async () => {
    const { store } = await setup({ breakStorage: true });
    await loaded(store);

    expect(store.state.themeMode).toBe("system");
    expect(store.state.uiFont).toBe("inter");
  });

  it("heals a corrupt font and writes the normalised value back", async () => {
    // Storage can hold anything: a hand edit, a restored backup, a build with
    // different options. Without the write-back it is re-read on every load.
    const { store, items } = await setup({ font: "comic-sans" });
    await loaded(store);

    expect(store.state.uiFont).toBe("inter");
    await vi.waitFor(async () =>
      expect(await items.uiFontItem.getValue()).toBe("inter")
    );
  });

  it("reads a theme saved under the driver's key, not the item's full key", async () => {
    // The regression this file exists to prevent. WXT splits `local:themeMode`
    // into area + driver key, so the stored key is `themeMode`. Reading back
    // `"local:themeMode"` returned nothing, the presence probe missed, and the
    // store resolved "system" for every user — the Appearance select would read
    // "Dark" while the page rendered light.
    const { items, store } = await setup();
    await items.themeModeItem.setValue("dark");

    expect(await browser.storage.local.get("themeMode")).toEqual({
      themeMode: "dark",
    });
    expect(await browser.storage.local.get("local:themeMode")).toEqual({});

    vi.resetModules();
    const reloaded = await import("./settings");
    await vi.waitFor(() =>
      expect(reloaded.settingsStore.state.isLoaded).toBe(true)
    );
    expect(reloaded.settingsStore.state.themeMode).toBe("dark");
    void store;
  });

  it("paints the stored font onto the document", async () => {
    const { store } = await setup({ font: "dyslexic" });
    await loaded(store);

    expect(document.documentElement.getAttribute(UI_FONT_ATTRIBUTE)).toBe(
      "dyslexic"
    );
    expect(store.state.uiFont).toBe("dyslexic");
  });

  it("paints the light or dark preset for the active UI theme", async () => {
    const light = await setup({
      theme: "light",
      lightTheme: "solarized-light",
      darkTheme: "okaidia",
    });
    await loaded(light.store);
    expect(light.store.state.lightCodeTheme).toBe("solarized-light");
    expect(document.documentElement.getAttribute(CODE_THEME_ATTRIBUTE)).toBe(
      "solarized-light"
    );

    const dark = await setup({
      theme: "dark",
      lightTheme: "solarized-light",
      darkTheme: "okaidia",
    });
    await loaded(dark.store);
    expect(document.documentElement.getAttribute(CODE_THEME_ATTRIBUTE)).toBe(
      "okaidia"
    );
  });

  it("heals a corrupt preset in either mode and writes it back", async () => {
    const { store, items } = await setup({
      lightTheme: "one-dark-pro",
      darkTheme: "github-light",
    });
    await loaded(store);

    expect(store.state.lightCodeTheme).toBe("github-light");
    expect(store.state.darkCodeTheme).toBe("one-dark-pro");
    await vi.waitFor(async () =>
      expect(await items.lightCodeThemeItem.getValue()).toBe("github-light")
    );
    await vi.waitFor(async () =>
      expect(await items.darkCodeThemeItem.getValue()).toBe("one-dark-pro")
    );
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("persistence", () => {
  it("does not overwrite a saved theme with the initial default", async () => {
    // The regression this guards: the store starts at "system", so an unguarded
    // persist effect writes that over a saved "dark" before the read lands.
    const { store, items } = await setup({ theme: "dark" });
    await loaded(store);

    expect(store.state.themeMode).toBe("dark");
    expect(await items.themeModeItem.getValue()).toBe("dark");
  });

  it("persists a later theme change", async () => {
    const { setThemeMode, store, items } = await setup({ theme: "light" });
    await loaded(store);

    setThemeMode("dark");
    await vi.waitFor(async () =>
      expect(await items.themeModeItem.getValue()).toBe("dark")
    );
  });

  it("persists a font change", async () => {
    const { store, items } = await setup({ font: "inter" });
    await loaded(store);

    store.setState((p) => ({ ...p, uiFont: "dyslexic" }));
    await vi.waitFor(async () =>
      expect(await items.uiFontItem.getValue()).toBe("dyslexic")
    );
  });

  it("persists code theme changes made in either picker", async () => {
    const { setLightCodeTheme, setDarkCodeTheme, store, items } = await setup();
    await loaded(store);

    setLightCodeTheme("solarized-light");
    setDarkCodeTheme("twilight");

    await vi.waitFor(async () =>
      expect(await items.lightCodeThemeItem.getValue()).toBe("solarized-light")
    );
    await vi.waitFor(async () =>
      expect(await items.darkCodeThemeItem.getValue()).toBe("twilight")
    );
  });
});

// ---------------------------------------------------------------------------
// Following the OS
// ---------------------------------------------------------------------------

describe("system theme changes", () => {
  it("repaints when the OS flips to dark while in system mode", async () => {
    const { store } = await setup({ theme: "system" });
    await loaded(store);
    expect(prefersDark()).toBe(false);

    systemPrefersDark = true;
    for (const listener of [...mediaListeners]) listener({});

    expect(store.state.resolvedTheme).toBe("dark");
    expect(prefersDark()).toBe(true);
  });

  it("ignores an OS change once the theme is pinned", async () => {
    // Pinning the theme has to actually pin it.
    const { store } = await setup({ theme: "light" });
    await loaded(store);

    systemPrefersDark = true;
    for (const listener of [...mediaListeners]) listener({});

    expect(store.state.resolvedTheme).toBe("light");
    expect(prefersDark()).toBe(false);
  });

  it("detaches its OS listener when the theme is pinned", async () => {
    // Otherwise a stale listener keeps rewriting the class behind the user's
    // back after they choose an explicit theme.
    const { setThemeMode, store } = await setup({ theme: "system" });
    await loaded(store);
    expect(mediaListeners.length).toBeGreaterThan(0);

    setThemeMode("dark");
    expect(mediaListeners).toHaveLength(0);
  });

  it("listens to the OS again when the theme returns to system", async () => {
    const { setThemeMode, store } = await setup({ theme: "dark" });
    await loaded(store);
    expect(mediaListeners).toHaveLength(0);

    setThemeMode("system");
    expect(mediaListeners.length).toBeGreaterThan(0);
  });

  it("switches the painted code palette when the UI theme changes", async () => {
    const { setThemeMode, store } = await setup({
      theme: "light",
      lightTheme: "github-light",
      darkTheme: "one-dark-pro",
    });
    await loaded(store);
    expect(document.documentElement.getAttribute(CODE_THEME_ATTRIBUTE)).toBe(
      "github-light"
    );

    setThemeMode("dark");
    expect(document.documentElement.getAttribute(CODE_THEME_ATTRIBUTE)).toBe(
      "one-dark-pro"
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-context sync
// ---------------------------------------------------------------------------

describe("font changed in another context", () => {
  it("adopts a font written by the popup", async () => {
    // The options page and the popup are separate documents. This watcher is
    // what stops one showing the old face until it reloads.
    const { store, items } = await setup({ font: "inter" });
    await loaded(store);

    await items.uiFontItem.setValue("dyslexic");
    await vi.waitFor(() => expect(store.state.uiFont).toBe("dyslexic"));
  });

  it("normalises a corrupt font arriving from another context", async () => {
    const { store, items } = await setup({ font: "inter" });
    await loaded(store);

    await writeUntyped(items.uiFontItem, "not-a-font");
    await vi.waitFor(() => expect(store.state.uiFont).toBe("inter"));
  });
});

describe("code theme changed in another context", () => {
  it("adopts either preset written by the options page", async () => {
    const { store, items } = await setup();
    await loaded(store);

    await items.lightCodeThemeItem.setValue("solarized-light");
    await vi.waitFor(() =>
      expect(store.state.lightCodeTheme).toBe("solarized-light")
    );
    await items.darkCodeThemeItem.setValue("twilight");
    await vi.waitFor(() => expect(store.state.darkCodeTheme).toBe("twilight"));
  });

  it("normalises a preset from the wrong mode", async () => {
    const { store, items } = await setup();
    await loaded(store);

    await writeUntyped(items.darkCodeThemeItem, "github-light");
    await vi.waitFor(() =>
      expect(store.state.darkCodeTheme).toBe("one-dark-pro")
    );
  });
});

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

describe("React bindings", () => {
  it("useTheme reports the applied theme, not the selection", async () => {
    // The distinction matters: in system mode on a dark OS these differ, and a
    // component branching on the applied theme must see the resolved value.
    const { useTheme, setThemeMode, store } = await setup();
    await loaded(store);
    systemPrefersDark = true;
    // Through the action, not a raw write: resolving "system" against the OS is
    // what the action is for, and writing `themeMode` alone would leave
    // `resolvedTheme` stale.
    act(() => setThemeMode("system"));
    expect(store.state.themeMode).toBe("system");

    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe("dark");
  });

  it("useThemeMode reports the user's selection, which may be system", async () => {
    const { useThemeMode, store } = await setup();
    await loaded(store);

    const { result } = renderHook(() => useThemeMode());
    expect(result.current).toBe(store.state.themeMode);
  });

  it("exposes both code presets through hooks", async () => {
    const { useLightCodeTheme, useDarkCodeTheme, store } = await setup({
      lightTheme: "solarized-light",
      darkTheme: "twilight",
    });
    await loaded(store);

    expect(renderHook(() => useLightCodeTheme()).result.current).toBe(
      "solarized-light"
    );
    expect(renderHook(() => useDarkCodeTheme()).result.current).toBe(
      "twilight"
    );
  });

  it("useSettings returns the selected slice and re-renders on change", async () => {
    // Also the reason this is a store rather than a context: a selector that
    // reads one field is not woken by a change to another.
    const { useSettings, setThemeMode, store } = await setup({
      theme: "light",
    });
    await loaded(store);

    const { result } = renderHook(() => useSettings((s) => s.themeMode));
    expect(result.current).toBe("light");

    act(() => setThemeMode("dark"));
    expect(result.current).toBe("dark");
  });
});
