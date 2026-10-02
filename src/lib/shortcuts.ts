/**
 * Keyboard shortcut grammar for Clipio.
 *
 * One module owns parsing, formatting and matching so the options page, the
 * shortcut recorder and the content script cannot drift apart.
 *
 * Before this module the content script matched only the *modifier flags* out of
 * the stored string and hardcoded the non-modifier key to Space
 * (`content.ts:1256-1268`), so a shortcut of `Cmd+K` never fired while the UI
 * advertised `Cmd+K` as valid. `matchesShortcut` compares the whole chord.
 *
 * Stored form is platform-neutral: `Mod` means ⌘ on macOS and Ctrl elsewhere,
 * so a payload synced from a Mac stays correct on Windows.
 *
 * spec: specs/options-redesign.spec.md
 */

export type Platform = "mac" | "other";

export interface ParsedShortcut {
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /**
   * Canonical `KeyboardEvent.key`-compatible name for the non-modifier key,
   * e.g. `Space`, `K`, `F2`, `ArrowUp`. Single letters are uppercased.
   */
  key: string;
}

// Canonical spellings for keys whose `KeyboardEvent.key` is not a plain name.
const KEY_ALIASES: Record<string, string> = {
  space: "Space",
  spacebar: "Space",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
};

const MODIFIER_TOKENS = new Set([
  "mod",
  "ctrl",
  "control",
  "cmd",
  "command",
  "meta",
  "alt",
  "option",
  "shift",
]);

/**
 * One segment of a rendered chord, so the UI can draw a glyph per part instead
 * of a single opaque string.
 */
export interface ShortcutSegment {
  kind: "mod" | "alt" | "shift" | "key";
  /** What to draw — a Lucide icon name for a modifier, the key name otherwise. */
  label: string;
}

/**
 * Split a parsed chord into drawable segments in conventional order.
 *
 * The recorder renders each segment as its own key cap (with a Lucide icon for
 * the modifiers), which is both more legible than `⌘⇧K` and more accessible:
 * a screen reader announces "Command Shift K" from the labels rather than
 * reading the glyphs.
 */
export function shortcutSegments(
  parsed: ParsedShortcut,
  platform: Platform = currentPlatform()
): ShortcutSegment[] {
  const segments: ShortcutSegment[] = [];
  // `Mod` resolves differently per platform: it is the Command key on macOS
  // and Control elsewhere. Drawing ⌘ to a Windows user would be wrong.
  if (parsed.mod) {
    segments.push({
      kind: "mod",
      label: platform === "mac" ? "command" : "control",
    });
  }
  if (parsed.alt) {
    segments.push({
      kind: "alt",
      label: platform === "mac" ? "option" : "alt",
    });
  }
  if (parsed.shift) segments.push({ kind: "shift", label: "shift" });
  segments.push({ kind: "key", label: parsed.key });
  return segments;
}

function isMac(): Platform {
  if (typeof navigator === "undefined") return "other";

  // `navigator.userAgentData.platform` is the modern source and is present in
  // Chromium. It is checked first because `navigator.platform` is deprecated
  // and returns an empty string in some Chromium contexts — which silently
  // downgraded every macOS chord to the "Ctrl" spelling.
  const candidates = [
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform,
    navigator.platform,
    // Last resort: the UA string still carries "Macintosh" even where the
    // structured fields are empty.
    navigator.userAgent,
  ];

  return candidates.some((v) => typeof v === "string" && /mac|iphone|ipad|ipod/i.test(v))
    ? "mac"
    : "other";
}

/** The current platform, narrowed. Exported for tests and platform-aware UI. */
export function currentPlatform(): Platform {
  return isMac();
}

/**
 * Canonical name for a non-modifier key, or `null` if it is itself a modifier.
 *
 * Modifier keys are rejected here rather than silently swallowed: a chord must
 * always name a real trigger key.
 */
function normalizeKey(raw: string): string | null {
  const token = raw.trim();
  if (!token) return null;
  const lower = token.toLowerCase();
  if (
    MODIFIER_TOKENS.has(lower) ||
    lower === "meta" ||
    lower === "os" ||
    lower === "super" ||
    lower === "win"
  ) {
    return null;
  }
  const aliased = KEY_ALIASES[lower];
  if (aliased) return aliased;
  // A single character key, canonicalised to uppercase so "k" === "K".
  if ([...token].length === 1) return token.toUpperCase();
  // Function keys and named keys arrive already canonical (F1, Home, …).
  return token;
}

/**
 * Parse a stored shortcut string into a chord, or `null` when it is unusable.
 *
 * Returns `null` for empty input, unknown modifiers, a missing trigger key, and
 * chords with no modifier at all — a bare `K` would fire on every `k` press.
 *
 * `Ctrl+` is preserved as a distinct modifier from `Mod` so that on macOS
 * Control remains a usable (if unusual) binding rather than collapsing into ⌘.
 */
export function parseShortcut(input: string): ParsedShortcut | null {
  if (typeof input !== "string") return null;

  const parts = input
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) return null;

  let mod = false;
  let shift = false;
  let alt = false;
  let key: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    switch (lower) {
      case "mod":
      case "cmd":
      case "command":
      case "meta":
      case "ctrl":
      case "control":
        // `Mod` is the portable spelling; `Ctrl`/`Command` are explicit. Both
        // set `mod` because the content script treats either ⌘ or Ctrl as the
        // primary modifier — matching the previous behaviour.
        mod = true;
        break;
      case "alt":
      case "option":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      default: {
        if (key !== null) return null; // two trigger keys is not a chord
        key = normalizeKey(part);
        if (key === null) return null;
      }
    }
  }

  if (key === null) return null;
  // A modifier-free chord would fire on every press of that key.
  if (!mod && !alt) return null;

  return { mod, shift, alt, key };
}

/**
 * Render a chord for display.
 *
 * macOS uses symbol glyphs and drops the redundant `Ctrl`; elsewhere the chord
 * is spelled out in the order Ctrl, Alt, Shift, Key.
 */
export function formatShortcut(
  parsed: ParsedShortcut,
  platform: Platform = currentPlatform()
): string {
  const symbols: Array<[boolean, string]> = [
    [parsed.mod, "⌘"],
    [parsed.alt, "⌥"],
    [parsed.shift, "⇧"],
  ];

  if (platform === "mac") {
    const prefix = symbols
      .filter(([on]) => on)
      .map(([, glyph]) => glyph)
      .join("");
    return `${prefix}${parsed.key}`;
  }

  const words: string[] = [];
  if (parsed.mod) words.push("Ctrl");
  if (parsed.alt) words.push("Alt");
  if (parsed.shift) words.push("Shift");
  words.push(parsed.key);
  return words.join("+");
}

/**
 * True when a chord is well-formed and required to carry at least one modifier.
 *
 * Exposed separately from `parseShortcut` so the recorder can distinguish
 * "rejected" from "not yet valid".
 */
export function isValidShortcut(input: string): boolean {
  return parseShortcut(input) !== null;
}

/** The subset of `KeyboardEvent` needed to match a chord. */
export interface ShortcutEventLike {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
  code?: string;
}

/**
 * Whether a keyboard event's non-modifier key satisfies the chord's trigger.
 *
 * Two passes, because they fail in different situations:
 *  - `key` is the logical key. Fails on non-Latin layouts, where pressing the
 *    physical `K` key reports `"л"`.
 *  - `code` is the physical key. Succeeds there, but is US-layout specific.
 *
 * `Space` gets a dedicated check because browsers disagree about whether it is
 * `" "` or `"Space"` and some layouts report the literal space character.
 */
function keyMatches(trigger: string, event: ShortcutEventLike): boolean {
  if (trigger === "Space") {
    return event.key === " " || event.code === "Space";
  }
  if (event.key && event.key.toUpperCase() === trigger.toUpperCase()) return true;
  if (event.code) {
    // `KeyK` → `K` for letters; `F2`, `Home`, `ArrowUp` pass through as-is.
    if (event.code === trigger) return true;
    if (event.code.startsWith("Key") && event.code.slice(3) === trigger) {
      return true;
    }
  }
  return false;
}

/**
 * Compare a parsed chord against a keyboard event.
 *
 * Every part of the chord must agree, which is what the content script's
 * previous check did not do for the trigger key.
 */
export function matchesShortcut(
  parsed: ParsedShortcut,
  event: ShortcutEventLike
): boolean {
  if (!keyMatches(parsed.key, event)) return false;

  // The primary modifier is satisfied by ⌘ or Ctrl, matching `parseShortcut`,
  // which folds `Ctrl` and `Command` into the same flag.
  const primary = event.ctrlKey || event.metaKey;
  if (parsed.mod !== primary) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;

  return true;
}

/**
 * Build a stored shortcut string from a live keyboard event.
 *
 * Returns `null` when the event cannot form a valid chord — a bare letter, a
 * lone modifier, or Escape — which is how the recorder signals "reject this".
 */
export function shortcutFromEvent(
  event: ShortcutEventLike
): ParsedShortcut | null {
  // Most browsers report the space bar as `key === " "`. That must be resolved
  // before `normalizeKey`, which trims its input and would reduce a literal
  // space to an empty string and reject the press.
  const key =
    event.key === " " || event.code === "Space"
      ? "Space"
      : normalizeKey(event.key);
  if (key === null) return null;
  // Escape is the recorder's cancel key, never a binding.
  if (key === "Escape") return null;

  const mod = event.ctrlKey || event.metaKey;
  if (!mod && !event.altKey) return null;

  return { mod, shift: event.shiftKey, alt: event.altKey, key };
}