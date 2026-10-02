/**
 * Tests for the keyboard shortcut grammar.
 *
 * spec: specs/options-redesign.spec.md
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  parseShortcut,
  formatShortcut,
  matchesShortcut,
  isValidShortcut,
  shortcutFromEvent,
  shortcutSegments,
  currentPlatform,
  type ParsedShortcut,
  type ShortcutEventLike,
} from "./shortcuts";

const chord = (partial: Partial<ParsedShortcut> = {}): ParsedShortcut => ({
  mod: true,
  shift: false,
  alt: false,
  key: "Space",
  ...partial,
});

const event = (partial: Partial<ShortcutEventLike> = {}): ShortcutEventLike => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  key: "",
  ...partial,
});

// ---------------------------------------------------------------------------
// parseShortcut
// ---------------------------------------------------------------------------

describe("parseShortcut", () => {
  it("parses the modifier-and-trigger grammar", () => {
    expect(parseShortcut("Mod+Shift+Space")).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: "Space",
    });
  });

  it("treats Control and Command spellings as the primary modifier", () => {
    expect(parseShortcut("Ctrl+K")).toEqual({
      mod: true,
      shift: false,
      alt: false,
      key: "K",
    });
    expect(parseShortcut("Command+Slash")).toEqual({
      mod: true,
      shift: false,
      alt: false,
      key: "Slash",
    });
  });

  it("uppercases single-character keys so 'k' and 'K' are one binding", () => {
    expect(parseShortcut("Mod+k")?.key).toBe("K");
  });

  it("accepts Alt on its own as the modifier", () => {
    expect(parseShortcut("Alt+Shift+P")).toEqual({
      mod: false,
      shift: true,
      alt: true,
      key: "P",
    });
  });

  // Negative cases — a silently-accepted chord is a shortcut that never fires.
  it("rejects a bare letter with no modifier", () => {
    expect(parseShortcut("K")).toBeNull();
  });

  it("rejects input with no trigger key", () => {
    expect(parseShortcut("Mod+Shift")).toBeNull();
    expect(parseShortcut("Mod+Ctrl")).toBeNull();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(parseShortcut("")).toBeNull();
    expect(parseShortcut("   ")).toBeNull();
    expect(parseShortcut("+")).toBeNull();
  });

  it("rejects two trigger keys", () => {
    expect(parseShortcut("Mod+K+J")).toBeNull();
  });

  it("rejects a non-string", () => {
    expect(parseShortcut(undefined as unknown as string)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatShortcut
// ---------------------------------------------------------------------------

describe("formatShortcut", () => {
  it("uses symbol glyphs on macOS", () => {
    expect(formatShortcut(chord({ shift: true }), "mac")).toBe("⌘⇧Space");
  });

  it("spells the chord out elsewhere", () => {
    expect(
      formatShortcut(chord({ shift: true, key: "Space" }), "other")
    ).toBe("Ctrl+Shift+Space");
  });

  it("renders Alt in the conventional position", () => {
    expect(formatShortcut(chord({ alt: true, key: "P" }), "other")).toBe(
      "Ctrl+Alt+P"
    );
  });

  it("round-trips through parse for a non-mac platform", () => {
    const parsed = parseShortcut("Mod+Shift+K");
    expect(parsed).not.toBeNull();
    const text = formatShortcut(parsed!, "other");
    expect(parseShortcut(text)).toEqual(parsed);
  });
});

// ---------------------------------------------------------------------------
// matchesShortcut
// ---------------------------------------------------------------------------

describe("matchesShortcut", () => {
  it("matches the full chord", () => {
    const parsed = parseShortcut("Mod+Shift+Space");
    expect(
      matchesShortcut(parsed!, event({ ctrlKey: true, shiftKey: true, key: " " }))
    ).toBe(true);
  });

  // This is the bug that motivated the module: the trigger key used to be
  // hardcoded to Space, so a Cmd+K binding never fired.
  it("matches a chord whose trigger is not Space", () => {
    const parsed = parseShortcut("Mod+K");
    expect(
      matchesShortcut(parsed!, event({ metaKey: true, key: "k" }))
    ).toBe(true);
  });

  it("accepts either Ctrl or Command for the primary modifier", () => {
    const parsed = parseShortcut("Mod+Space");
    expect(
      matchesShortcut(parsed!, event({ ctrlKey: true, key: " " }))
    ).toBe(true);
    expect(
      matchesShortcut(parsed!, event({ metaKey: true, key: " " }))
    ).toBe(true);
  });

  it("matches Space via the code when the layout reports a literal space", () => {
    const parsed = parseShortcut("Mod+Space");
    expect(
      matchesShortcut(parsed!, event({ metaKey: true, key: " ", code: "Space" }))
    ).toBe(true);
  });

  it("matches a letter on a layout that reports a different character", () => {
    const parsed = parseShortcut("Mod+K");
    // A Cyrillic layout: physical K reports "л" but code is still "KeyK".
    expect(
      matchesShortcut(parsed!, event({ metaKey: true, key: "л", code: "KeyK" }))
    ).toBe(true);
  });

  // Negative cases.
  it("rejects the right trigger with the wrong modifier", () => {
    const parsed = parseShortcut("Mod+Shift+Space");
    expect(
      matchesShortcut(parsed!, event({ ctrlKey: true, key: " " }))
    ).toBe(false);
  });

  it("rejects an unmodified keypress", () => {
    const parsed = parseShortcut("Mod+Space");
    expect(matchesShortcut(parsed!, event({ key: " " }))).toBe(false);
  });

  it("rejects a different trigger key", () => {
    const parsed = parseShortcut("Mod+K");
    expect(
      matchesShortcut(parsed!, event({ metaKey: true, key: "J" }))
    ).toBe(false);
  });

  it("rejects an extra modifier the chord does not declare", () => {
    const parsed = parseShortcut("Mod+Space");
    expect(
      matchesShortcut(
        parsed!,
        event({ metaKey: true, shiftKey: true, key: " " })
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidShortcut / shortcutFromEvent
// ---------------------------------------------------------------------------

describe("isValidShortcut", () => {
  it("agrees with parseShortcut", () => {
    expect(isValidShortcut("Mod+Shift+Space")).toBe(true);
    expect(isValidShortcut("K")).toBe(false);
    expect(isValidShortcut("")).toBe(false);
  });
});

describe("currentPlatform", () => {
  const original = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
    });
  });

  const setNavigator = (value: Partial<Navigator>) => {
    Object.defineProperty(globalThis, "navigator", {
      value: value,
      configurable: true,
    });
  };

  // Regression: `navigator.platform` returned "" in the Chromium build used for
  // e2e, so every macOS chord rendered with the "Ctrl" spelling.
  it("detects macOS from the userAgent when platform is empty", () => {
    setNavigator({
      platform: "",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    } as Partial<Navigator>);
    expect(currentPlatform()).toBe("mac");
  });

  it("detects macOS from userAgentData", () => {
    setNavigator({
      userAgentData: { platform: "macOS" },
    } as unknown as Partial<Navigator>);
    expect(currentPlatform()).toBe("mac");
  });

  it("detects non-macOS platforms", () => {
    setNavigator({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    } as Partial<Navigator>);
    expect(currentPlatform()).toBe("other");
  });

  // Negative: no signal at all must fall back rather than throw.
  it("falls back to non-mac when no signal is available", () => {
    setNavigator({} as Partial<Navigator>);
    expect(currentPlatform()).toBe("other");
  });
});

describe("shortcutSegments", () => {
  it("splits a chord into one segment per part, in reading order", () => {
    expect(shortcutSegments(parseShortcut("Mod+Shift+Space")!, "other")).toEqual([
      { kind: "mod", label: "control" },
      { kind: "shift", label: "shift" },
      { kind: "key", label: "Space" },
    ]);
  });

  it("names the primary modifier Command on macOS and Control elsewhere", () => {
    const parsed = parseShortcut("Mod+K")!;
    // Drawing ⌘ to a Windows user (or "Ctrl" to a Mac user) would misstate the
    // binding they actually have.
    expect(shortcutSegments(parsed, "mac")[0].label).toBe("command");
    expect(shortcutSegments(parsed, "other")[0].label).toBe("control");
  });

  it("names Alt Option on macOS", () => {
    const parsed = parseShortcut("Alt+P")!;
    expect(shortcutSegments(parsed, "mac")[0].label).toBe("option");
    expect(shortcutSegments(parsed, "other")[0].label).toBe("alt");
  });

  it("orders modifiers before the trigger key", () => {
    const segments = shortcutSegments(parseShortcut("Mod+Alt+Shift+K")!, "mac");
    expect(segments.map((s) => s.kind)).toEqual([
      "mod",
      "alt",
      "shift",
      "key",
    ]);
    expect(segments[segments.length - 1].label).toBe("K");
  });

  it("emits only the trigger key when there are no modifiers", () => {
    // parseShortcut rejects modifier-free chords, so this documents the
    // invariant rather than a reachable input.
    const segments = shortcutSegments(
      { mod: false, alt: false, shift: false, key: "F2" },
      "other"
    );
    expect(segments).toEqual([{ kind: "key", label: "F2" }]);
  });
});

describe("shortcutFromEvent", () => {
  it("builds a chord from a live keypress", () => {
    expect(
      shortcutFromEvent(event({ metaKey: true, shiftKey: true, key: "k" }))
    ).toEqual({ mod: true, shift: true, alt: false, key: "K" });
  });

  it("rejects a bare letter so the recorder can refuse it", () => {
    expect(shortcutFromEvent(event({ key: "k" }))).toBeNull();
  });

  it("rejects a lone modifier press", () => {
    expect(shortcutFromEvent(event({ ctrlKey: true, key: "Control" }))).toBeNull();
  });

  it("rejects Escape, which is the recorder's cancel key", () => {
    expect(
      shortcutFromEvent(event({ ctrlKey: true, key: "Escape" }))
    ).toBeNull();
  });

  it("produces a chord that matches the event it came from", () => {
    const source = event({ ctrlKey: true, shiftKey: true, key: " " });
    const parsed = shortcutFromEvent(source);
    expect(parsed).not.toBeNull();
    expect(matchesShortcut(parsed!, source)).toBe(true);
  });
});