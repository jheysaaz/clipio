/**
 * The settings registry.
 *
 * One declarative list of every user-facing preference. The sidebar, the search
 * results and each section's rows are all projections of this array — which is
 * what lets search results render a setting's *live control* rather than a link
 * to the section that happens to contain it.
 *
 * An entry is data, not a component: `control` names the widget and
 * `useValue`/`setValue` read and write storage. React stays out of this module
 * so the filtering below can be unit-tested without a renderer.
 *
 * spec: specs/options-redesign.spec.md
 */

import {
  confettiEnabledItem,
  typingTimeoutItem,
  snippetPreviewEnabledItem,
  snippetPreviewPrefixItem,
  snippetPreviewShortcutItem,
  blockedSitesItem,
  debugModeItem,
  giphyApiKeyItem,
  storageModeItem,
  themeModeItem,
  type ThemeMode,
} from "@/storage/items";
import { forceSetStorageMode } from "@/storage";
import type { StorageMode } from "@/storage";
import { TIMING } from "@/config/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingControl =
  "switch" | "select" | "shortcut" | "slider" | "text" | "site-list";

export type SectionId =
  | "library"
  | "images"
  | "expansion"
  | "blocked-sites"
  | "appearance"
  | "storage"
  | "diagnostics"
  | "about";

/**
 * Locale keys for a setting's title and description, as literal unions.
 *
 * `i18n.t` is typed against the keys WXT generates from en.yml, so it rejects a
 * bare `string`. Spelling these out makes a renamed or deleted key a **compile
 * error** rather than a silently untranslated row — the same technique
 * `app-sidebar.tsx` uses for its nav labels. spec: specs/i18n.spec.md
 */
export type SettingTitleKey =
  | "options.setting.previewEnabled.title"
  | "options.setting.previewPrefix.title"
  | "options.setting.previewShortcut.title"
  | "options.setting.typingTimeout.title"
  | "options.setting.blockedSites.title"
  | "options.setting.theme.title"
  | "options.setting.confetti.title"
  | "options.setting.storageMode.title"
  | "options.setting.debugMode.title"
  | "options.setting.giphyKey.title";

export type SettingDescKey =
  | "options.setting.previewEnabled.desc"
  | "options.setting.previewPrefix.desc"
  | "options.setting.previewShortcut.desc"
  | "options.setting.typingTimeout.desc"
  | "options.setting.blockedSites.desc"
  | "options.setting.theme.desc"
  | "options.setting.confetti.desc"
  | "options.setting.storageMode.desc"
  | "options.setting.debugMode.desc"
  | "options.setting.giphyKey.desc";

/** Locale key for a nav label. */
export type NavLabelKey =
  | "options.nav.library"
  | "options.nav.images"
  | "options.nav.expansion"
  | "options.nav.blockedSites"
  | "options.nav.appearance"
  | "options.nav.storage"
  | "options.nav.diagnostics"
  | "options.nav.about";

/** Locale key for a select option's label. */
export type OptionLabelKey =
  | "options.theme.light"
  | "options.theme.dark"
  | "options.theme.system"
  | "options.storage.backend.sync"
  | "options.storage.backend.local";

/** Locale key for a sidebar group heading. */
export type GroupLabelKey =
  | "options.groups.library"
  | "options.groups.behaviour"
  | "options.groups.appearance"
  | "options.groups.system";

/**
 * Maps a section id to its nav label key.
 *
 * Section ids are kebab-case because they appear in the URL hash, which is not
 * a valid place for a camelCase locale segment — `blocked-sites` cannot also be
 * `blockedSites`. This table is the single place that mismatch is reconciled.
 */
export const SECTION_LABEL_KEYS: Record<SectionId, NavLabelKey> = {
  library: "options.nav.library",
  images: "options.nav.images",
  expansion: "options.nav.expansion",
  "blocked-sites": "options.nav.blockedSites",
  appearance: "options.nav.appearance",
  storage: "options.nav.storage",
  diagnostics: "options.nav.diagnostics",
  about: "options.nav.about",
};

export interface SettingEntry {
  /** Stable, kebab-case. Doubles as the search result anchor. */
  id: string;
  section: SectionId;
  /** Locale key, resolved with `i18n.t` at render time. */
  titleKey: SettingTitleKey;
  /** Locale key for the one-line description. */
  descKey: SettingDescKey;
  control: SettingControl;
  /**
   * True when a section panel renders this setting's control, so the section
   * body must not also draw the row. Still searchable, and the row still
   * renders in search results where it links back to the owning section.
   */
  panelOwned?: boolean;
  /**
   * Extra terms search should match on — the words a user would type that are
   * not in the title. e.g. "keyboard", "quota", "giphy".
   */
  keywords?: readonly string[];
  /** Values offered by a `select` control. */
  options?: readonly { value: string; labelKey: OptionLabelKey }[];
  /** Allowed range and step for a `slider` control. */
  range?: { min: number; max: number; step: number };
  /** Factory text for a `text` control. */
  placeholder?: string;
  /** Mask the `text` control's characters. Only for genuinely secret values. */
  secret?: boolean;
  /**
   * The shipped default, compared against the live value to decide whether the
   * row is dirty enough to offer "reset to default".
   *
   * Declared here rather than inferred by calling `reset()` — which would write
   * storage just to answer a rendering question.
   */
  defaultValue?: unknown;
  /** Read the current value. */
  useValue: () => Promise<unknown>;
  /**
   * Persist a new value.
   *
   * Typed `any` because the registry is heterogeneous by design — a switch
   * receives `boolean`, a slider a `number`, a site list a `string[]`. Each
   * entry narrows its own handler to the right type (e.g.
   * `(v: boolean) => …`), so the value reaching storage is checked at the
   * handler, and the renderer narrows again on `entry.control`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: (value: any) => Promise<void>;
  /** Restores the shipped default. */
  reset?: () => Promise<void>;
  /** Stable e2e / component handle. */
  testId: string;
}

export interface SectionMeta {
  id: SectionId;
  /** Locale key for the nav label. */
  labelKey: NavLabelKey;
  /** Sidebar group heading, or `null` when the section starts its own group. */
  groupKey: GroupLabelKey | null;
  icon: string;
  /**
   * Whether the section renders registry-driven setting rows or bespoke content.
   *
   * Library and About are data surfaces (media library, usage charts, version
   * info) rather than preferences, so they have no rows. The search index
   * covers settings only; content sections are reached from the nav.
   */
  kind: "settings" | "content";
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SECTIONS: readonly SectionMeta[] = [
  {
    id: "library",
    labelKey: "options.nav.library",
    groupKey: "options.groups.library",
    icon: "library",
    kind: "content",
  },
  {
    id: "images",
    labelKey: "options.nav.images",
    groupKey: "options.groups.library",
    icon: "images",
    kind: "content",
  },
  {
    id: "expansion",
    labelKey: "options.nav.expansion",
    groupKey: "options.groups.behaviour",
    icon: "zap",
    kind: "settings",
  },
  {
    id: "blocked-sites",
    labelKey: "options.nav.blockedSites",
    groupKey: "options.groups.behaviour",
    icon: "globe",
    kind: "settings",
  },
  {
    id: "appearance",
    labelKey: "options.nav.appearance",
    groupKey: "options.groups.appearance",
    icon: "palette",
    kind: "settings",
  },
  {
    id: "storage",
    labelKey: "options.nav.storage",
    groupKey: "options.groups.system",
    icon: "cloud",
    kind: "settings",
  },
  {
    id: "diagnostics",
    labelKey: "options.nav.diagnostics",
    groupKey: "options.groups.system",
    icon: "code",
    kind: "settings",
  },
  {
    id: "about",
    labelKey: "options.nav.about",
    groupKey: "options.groups.system",
    icon: "info",
    kind: "content",
  },
] as const;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SETTINGS: readonly SettingEntry[] = [
  // ── Library ───────────────────────────────────────────────────────────────
  {
    id: "preview-enabled",
    section: "expansion",
    titleKey: "options.setting.previewEnabled.title",
    descKey: "options.setting.previewEnabled.desc",
    control: "switch",
    keywords: ["preview", "menu", "autocomplete", "suggest"],
    useValue: () => snippetPreviewEnabledItem.getValue(),
    setValue: (v: boolean) => snippetPreviewEnabledItem.setValue(v),
    defaultValue: true,
    testId: "setting-preview-enabled",
  },
  {
    id: "preview-prefix",
    section: "expansion",
    titleKey: "options.setting.previewPrefix.title",
    descKey: "options.setting.previewPrefix.desc",
    control: "text",
    keywords: ["prefix", "trigger", "slash", "character"],
    placeholder: "/",
    useValue: () => snippetPreviewPrefixItem.getValue(),
    setValue: (v: string) => snippetPreviewPrefixItem.setValue(v),
    reset: () => snippetPreviewPrefixItem.setValue("/"),
    defaultValue: "/",
    testId: "setting-preview-prefix",
  },
  {
    id: "preview-shortcut",
    section: "expansion",
    titleKey: "options.setting.previewShortcut.title",
    descKey: "options.setting.previewShortcut.desc",
    control: "shortcut",
    keywords: ["keyboard", "hotkey", "binding", "shortcut", "trigger"],
    useValue: () => snippetPreviewShortcutItem.getValue(),
    setValue: (v: string) => snippetPreviewShortcutItem.setValue(v),
    reset: () => snippetPreviewShortcutItem.setValue("Mod+Shift+Space"),
    defaultValue: "Mod+Shift+Space",
    testId: "setting-preview-shortcut",
  },
  {
    id: "typing-timeout",
    section: "expansion",
    titleKey: "options.setting.typingTimeout.title",
    descKey: "options.setting.typingTimeout.desc",
    control: "slider",
    keywords: ["delay", "debounce", "speed", "expand", "ms"],
    range: { min: 50, max: 2000, step: 50 },
    useValue: () => typingTimeoutItem.getValue(),
    setValue: (v: number) => typingTimeoutItem.setValue(v),
    reset: () => typingTimeoutItem.setValue(TIMING.TYPING_TIMEOUT),
    defaultValue: TIMING.TYPING_TIMEOUT,
    testId: "card-typing-timeout",
  },
  {
    id: "blocked-sites",
    section: "blocked-sites",
    titleKey: "options.setting.blockedSites.title",
    descKey: "options.setting.blockedSites.desc",
    control: "site-list",
    // The section renders `BlockedSitesPanel`, which owns the list. This entry
    // exists so the setting is *searchable* and links to that section; drawing
    // the row inside the section too would put a stub reading "Managed in its
    // section" directly beneath the section that manages it.
    panelOwned: true,
    keywords: ["hide", "disable", "exclude", "domain", "hostname", "off"],
    useValue: () => blockedSitesItem.getValue(),
    setValue: (v: string[]) => blockedSitesItem.setValue(v),
    defaultValue: [],
    testId: "setting-blocked-sites",
  },

  // ── Appearance ────────────────────────────────────────────────────────────
  {
    id: "theme",
    section: "appearance",
    titleKey: "options.setting.theme.title",
    descKey: "options.setting.theme.desc",
    control: "select",
    keywords: ["dark", "light", "system", "colour", "color", "mode"],
    options: [
      { value: "light", labelKey: "options.theme.light" },
      { value: "dark", labelKey: "options.theme.dark" },
      { value: "system", labelKey: "options.theme.system" },
    ],
    useValue: () => themeModeItem.getValue(),
    setValue: (v: ThemeMode) => themeModeItem.setValue(v),
    reset: () => themeModeItem.setValue("system"),
    defaultValue: "system",
    testId: "setting-theme",
  },
  {
    id: "confetti",
    section: "appearance",
    titleKey: "options.setting.confetti.title",
    descKey: "options.setting.confetti.desc",
    control: "switch",
    keywords: ["celebrate", "animation", "sparkle", "fun", "effect"],
    useValue: () => confettiEnabledItem.getValue(),
    setValue: (v: boolean) => confettiEnabledItem.setValue(v),
    reset: () => confettiEnabledItem.setValue(true),
    defaultValue: true,
    testId: "confetti-toggle",
  },

  // ── Storage ───────────────────────────────────────────────────────────────
  {
    id: "storage-mode",
    section: "storage",
    titleKey: "options.setting.storageMode.title",
    descKey: "options.setting.storageMode.desc",
    control: "select",
    keywords: [
      "sync",
      "local",
      "backend",
      "devices",
      "quota",
      "backup",
      "cloud",
    ],
    options: [
      { value: "sync", labelKey: "options.storage.backend.sync" },
      { value: "local", labelKey: "options.storage.backend.local" },
    ],
    useValue: () => storageModeItem.getValue(),
    setValue: (v: StorageMode) => forceSetStorageMode(v),
    defaultValue: "sync",
    testId: "card-storage-mode",
  },

  // ── Diagnostics ───────────────────────────────────────────────────────────
  {
    id: "debug-mode",
    section: "diagnostics",
    titleKey: "options.setting.debugMode.title",
    descKey: "options.setting.debugMode.desc",
    control: "switch",
    keywords: ["logging", "log", "verbose", "console", "troubleshoot"],
    useValue: () => debugModeItem.getValue(),
    setValue: (v: boolean) => debugModeItem.setValue(v),
    reset: () => debugModeItem.setValue(false),
    defaultValue: false,
    testId: "setting-debug-mode",
  },
  {
    id: "giphy-key",
    section: "diagnostics",
    titleKey: "options.setting.giphyKey.title",
    descKey: "options.setting.giphyKey.desc",
    control: "text",
    keywords: ["api", "gif", "image", "key", "token", "developer"],
    placeholder: "••••••••••••",
    secret: true,
    useValue: () => giphyApiKeyItem.getValue(),
    setValue: (v: string) => giphyApiKeyItem.setValue(v),
    reset: () => giphyApiKeyItem.setValue(""),
    defaultValue: "",
    testId: "setting-giphy-key",
  },
] as const;

// ---------------------------------------------------------------------------
// Lookup + search
// ---------------------------------------------------------------------------

export function getSection(id: SectionId): SectionMeta | undefined {
  return SECTIONS.find((s) => s.id === id);
}

export function getSetting(id: string): SettingEntry | undefined {
  return SETTINGS.find((s) => s.id === id);
}

export function settingsForSection(section: SectionId): SettingEntry[] {
  return SETTINGS.filter((s) => s.section === section);
}

/**
 * Rows a section body should draw — i.e. everything except settings whose
 * control a panel already renders.
 */
export function rowsForSection(section: SectionId): SettingEntry[] {
  return settingsForSection(section).filter((s) => !s.panelOwned);
}

/**
 * Normalise a query for comparison: lowercase, strip diacritics.
 *
 * Without the diacritic fold a Spanish user typing "confeti" or "tematica"
 * gets no results from an English or accented locale.
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Rank settings against a query.
 *
 * Scoring is deliberately simple and ordered: an id match outranks a title
 * match, which outranks a keyword match. Prefix matches outrank substring
 * matches, so typing "con" surfaces confetti above a setting that merely
 * mentions "connection" in its description.
 *
 * Returns `[]` for an empty query — callers show all settings instead.
 */
export function searchSettings(
  query: string,
  entries: readonly SettingEntry[] = SETTINGS
): SettingEntry[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const scored: Array<{ entry: SettingEntry; score: number }> = [];

  for (const entry of entries) {
    const id = normalizeQuery(entry.id);
    const title = normalizeQuery(entry.titleKey.split(".").pop() ?? "");
    const keywords = normalizeQuery((entry.keywords ?? []).join(" "));

    let score = 0;
    if (id === q) score = 100;
    else if (id.startsWith(q)) score = 80;
    else if (title.startsWith(q)) score = 70;
    else if (title.includes(q)) score = 50;
    else if (keywords.startsWith(q)) score = 40;
    else if (keywords.includes(q)) score = 30;

    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .map((s) => s.entry);
}
