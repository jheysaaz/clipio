/**
 * The `{{image:…}}` and `{{gif:…}}` placeholder grammar, in one place.
 *
 * These two placeholders used to be matched by 17 hand-retyped regular
 * expressions across 9 modules, in three incompatible flavours. Two of those
 * flavours were outright wrong:
 *
 * - `SnippetListItem` omitted the optional width, so a resized image — written
 *   as `{{image:<id>:200}}` the moment a user drags it — was not recognised in
 *   the snippet list and the raw placeholder text was shown instead.
 * - `content-helpers` matched `[^}]+` and used the whole capture as the media id,
 *   so for a resized reference the "id" was `<id>:200` and could never match a
 *   stored entry.
 *
 * Everything here is defined so that **capture group 1 is always the id** and
 * group 2 is always the width. That single invariant is what makes the previous
 * class of bug impossible to reintroduce by copy-paste.
 */

// Media ids are `crypto.randomUUID()` values for blobs created here, but ZIP
// imports and backups deliberately accept other opaque tokens too (see
// `isValidMediaId` in the importer). Those two charsets used to disagree: an
// imported `{{image:media_1}}` was stored and listed as valid by the importer,
// then rendered as literal text by every placeholder consumer because the
// grammar only allowed hex and dashes. One charset now serves both boundaries.
//
// Deliberately NOT widened to `[^:}]+`. A loose charset would turn a literal
// `{{image:whatever}}` in someone's snippet into an <img> with a broken source,
// which is worse than leaving it as visible text.
export const MEDIA_ID_PATTERN_SOURCE = "[A-Za-z0-9_-]{1,64}";

const IMAGE_ID = MEDIA_ID_PATTERN_SOURCE;
const GIF_ID = MEDIA_ID_PATTERN_SOURCE;

/** `:width`, optional, digits only. */
const WIDTH = "(?::(\\d+))?";

/**
 * Anchored patterns, for scanning at a position — e.g. walking a string in a
 * renderer that needs to know what starts *here*.
 *
 * Group 1 = id, group 2 = width (or undefined).
 */
export const IMAGE_PLACEHOLDER_ANCHORED = new RegExp(
  `^\\{\\{image:(${IMAGE_ID})${WIDTH}\\}\\}`
);
export const GIF_PLACEHOLDER_ANCHORED = new RegExp(
  `^\\{\\{gif:(${GIF_ID})${WIDTH}\\}\\}`
);

/**
 * Global patterns, for finding every reference in a body.
 *
 * Group 1 = id, group 2 = width (or undefined). These are constructed fresh on
 * every call because a `g` regex carries `lastIndex` between uses, and a shared
 * one would make results depend on call order — a genuinely nasty class of bug.
 */
export const imagePlaceholderGlobal = (): RegExp =>
  new RegExp(`\\{\\{image:(${IMAGE_ID})${WIDTH}\\}\\}`, "g");
export const gifPlaceholderGlobal = (): RegExp =>
  new RegExp(`\\{\\{gif:(${GIF_ID})${WIDTH}\\}\\}`, "g");

/** Either kind, global. Group 1 = kind, group 2 = id, group 3 = width. */
export const anyMediaPlaceholderGlobal = (): RegExp =>
  new RegExp(`\\{\\{(image|gif):(${IMAGE_ID}|${GIF_ID})${WIDTH}\\}\\}`, "g");

/** A parsed reference. `width` is a number, or null when absent or unparseable. */
export type MediaRef = {
  kind: "image" | "gif";
  id: string;
  width: number | null;
};

/** Plain-text labels used wherever an image/GIF cannot be shown. */
export const MEDIA_TEXT_LABELS = {
  image: "[image]",
  gif: "[GIF]",
} as const;

/**
 * The same opaque-token check the ZIP importer applies to media metadata.
 *
 * Keeping it here means a blob accepted by an import can always be referenced
 * by a placeholder in the snippets imported alongside it.
 */
export function isValidMediaId(id: unknown): boolean {
  return (
    typeof id === "string" &&
    new RegExp(`^${MEDIA_ID_PATTERN_SOURCE}$`).test(id)
  );
}

/** Build the canonical reference string. Omit `width` for an unsized one. */
export function formatImagePlaceholder(id: string, width?: number): string {
  return width === undefined ? `{{image:${id}}}` : `{{image:${id}:${width}}}`;
}

export function formatGifPlaceholder(id: string, width?: number): string {
  return width === undefined ? `{{gif:${id}}}` : `{{gif:${id}:${width}}}`;
}

/**
 * Parse one placeholder token.
 *
 * Accepts the token with or without its surrounding braces, so a caller that has
 * already sliced the token out does not have to re-add them.
 *
 * Returns null for anything that is not a well-formed reference — an unknown
 * kind, an id outside the charset, an empty id. Callers render unknown text as
 * literal text, which is the safe outcome.
 */
export function parseMediaPlaceholder(token: string): MediaRef | null {
  // Accept the token with or without its braces, so a caller that already sliced
  // the token out of a body does not have to re-add them. Braces must be
  // balanced though: a truncated `{{image:<id>` would otherwise be
  // indistinguishable from the bare `image:<id>` form and be accepted.
  const braced = token.startsWith("{{");
  if (braced && !token.endsWith("}}")) return null;
  const body = braced ? token.slice(2, -2) : token;
  const match = body.match(
    new RegExp(`^(image|gif):(${IMAGE_ID}|${GIF_ID})${WIDTH}$`)
  );
  if (!match) return null;
  const [, kind, id, rawWidth] = match;
  if (kind !== "image" && kind !== "gif") return null;
  return {
    kind,
    id: id!,
    width: rawWidth === undefined ? null : Number.parseInt(rawWidth, 10),
  };
}

/** True if the body contains at least one image or GIF reference. */
export function hasMediaPlaceholder(content: string): boolean {
  return anyMediaPlaceholderGlobal().test(content);
}

/** True if the body contains at least one image reference. */
export function hasImagePlaceholder(content: string): boolean {
  return imagePlaceholderGlobal().test(content);
}

/**
 * Every media reference in the body, in order of appearance.
 *
 * Duplicates are preserved: which call sites deduplicate is their own decision,
 * and the exporter and the clipboard path genuinely disagree about it. Removing
 * that decision from this function is the point.
 */
export function extractMediaRefs(content: string): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const match of content.matchAll(anyMediaPlaceholderGlobal())) {
    const [, kind, id, rawWidth] = match;
    if (kind !== "image" && kind !== "gif") continue;
    refs.push({
      kind,
      id: id!,
      width: rawWidth === undefined ? null : Number.parseInt(rawWidth, 10),
    });
  }
  return refs;
}

/** Just the ids, in order, duplicates included. */
export function extractMediaIds(content: string): string[] {
  return extractMediaRefs(content).map((ref) => ref.id);
}

/** The image ids referenced by the body. */
export function extractImageIds(content: string): string[] {
  return extractMediaRefs(content)
    .filter((ref) => ref.kind === "image")
    .map((ref) => ref.id);
}

/** The GIF ids referenced by the body. */
export function extractGifIds(content: string): string[] {
  return extractMediaRefs(content)
    .filter((ref) => ref.kind === "gif")
    .map((ref) => ref.id);
}

/**
 * Replace every reference with a short plain-text label.
 *
 * For the plain-text and list-summary paths, where a reference should read as
 * "[image]" rather than as its raw id. A sized reference collapses to the same
 * label as an unsized one, since the width means nothing in plain text.
 */
export function stripMediaPlaceholders(
  content: string,
  labels: { image?: string; gif?: string } = {}
): string {
  const imageLabel = labels.image ?? MEDIA_TEXT_LABELS.image;
  const gifLabel = labels.gif ?? MEDIA_TEXT_LABELS.gif;
  return content
    .replace(imagePlaceholderGlobal(), imageLabel)
    .replace(gifPlaceholderGlobal(), gifLabel);
}

/**
 * Rewrite placeholder ids after restore dedup collapsed two blobs into one.
 *
 * A restore that finds the same hash under another id must not leave snippets
 * pointing at an id that was never stored. Only ids present in the map change;
 * width and kind are preserved, and surrounding text is untouched.
 */
export function remapMediaIds(
  content: string,
  ids: Map<string, string>
): string {
  if (ids.size === 0) return content;

  return content.replace(
    anyMediaPlaceholderGlobal(),
    (match, kind: string, id: string, width: string | undefined) => {
      const next = ids.get(id);
      if (!next || next === id) return match;
      return `{{${kind}:${next}${width === undefined ? "" : `:${width}`}}}`;
    }
  );
}
