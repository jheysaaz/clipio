/**
 * The settings search index.
 *
 * WHAT THIS REPLACES
 *
 * `registry.ts` used to carry its own `searchSettings`, which scored a query
 * against `entry.titleKey.split(".").pop()` — that is, against the i18n *key*
 * name. For `options.setting.fontFamily.title` it indexed the string
 * "fontfamily". So a user searching for the words actually on screen got
 * nothing, and `descKey` was never indexed at all.
 *
 * The concrete failure this exists to fix: searching the options page for
 * `opendyslexic` returned no results, even though "OpenDyslexic" is one of the
 * three options rendered inside that setting's select and the row was sitting
 * right there on the Appearance section.
 *
 * THE RULE
 *
 * Every character a setting renders must be searchable. That is the resolved
 * title and description, the labels of every option it offers, the font family
 * names behind those labels, its keywords, and the section and control it
 * belongs to. `keywords` survives as the hand-authored escape hatch for words
 * only we would think of — "quota", "giphy", "confetti" — but nothing that is
 * visible depends on someone remembering to add it.
 *
 * WHY A SEPARATE MODULE
 *
 * `registry.ts` is declarative data with no React and no i18n resolution. This
 * module resolves copy and folds it, which is a different job with different
 * inputs. Keeping them apart means the ranking below is testable with synthetic
 * entries and no renderer, which is why it takes the registry as an argument
 * instead of importing it.
 */

import { foldWords, tokenizeQuery, type FoldedWord } from "./text-fold";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Where an indexed field came from.
 *
 * The kind carries the ranking weight, so a hit in an option label can
 * outrank a passing mention in a description without either being able to
 * outrank a title hit.
 */
export type SettingFieldKind =
  /** The full kebab-case id, e.g. "font-family". */
  | "id"
  /** A resolved option label, e.g. "OpenDyslexic". */
  | "option"
  /** A font family name behind an option label, e.g. "Segoe UI". */
  | "font"
  /** A hand-authored keyword. */
  | "keyword"
  /** The resolved setting title. */
  | "title"
  /** The resolved setting description. */
  | "desc"
  /** The section label, e.g. "Appearance". */
  | "section"
  /** The control name, e.g. "switch". */
  | "control";

/** One indexed field: the words of a string, with offsets into that string. */
export type SettingIndexField = {
  kind: SettingFieldKind;
  /** The string the offsets refer to, unfolded. */
  text: string;
  words: FoldedWord[];
};

/**
 * The shape this module needs from a setting.
 *
 * Structural rather than imported from the registry, so `lib/` does not depend
 * on `components/` and so tests can build entries without pulling in storage
 * items. `SettingEntry` satisfies it as-is.
 */
export type IndexableSetting = {
  id: string;
  section: string;
  titleKey: string;
  descKey: string;
  control: string;
  keywords?: readonly string[];
  options?: readonly { value: string; labelKey: string }[];
  optionFonts?: Readonly<Record<string, string>>;
};

export type SettingIndexEntry = {
  /** The setting's id, so a caller can get back to the entry. */
  id: string;
  /** The setting's section, so a result can be navigated to. */
  section: string;
  fields: SettingIndexField[];
};

/** A highlighted match inside the row's rendered title. */
export type SettingHit = {
  kind: "title";
  /** Offset into the title's original text. */
  start: number;
  /** End offset (exclusive). */
  end: number;
};

export type SettingMatch = {
  entry: SettingIndexEntry;
  /** Higher is a better match. See `SCORE` for the weights. */
  score: number;
  /**
   * Ranges to highlight in the title.
   *
   * Empty when the match landed only in a field the row does not render — an
   * option label or a keyword, say. That is the common case for a hit like
   * `opendyslexic`, and it is not an error: there is simply nothing in the
   * visible heading to underline.
   */
  hits: SettingHit[];
};

/** Resolves an i18n key to displayable copy. */
export type Translate = (key: string) => string;

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Weight per field kind, for a token that matches a whole word.
 *
 * Ordered by how deliberate the match is. The id is the most stable identifier
 * a setting has, so it wins outright; the title is what the user reads next;
 * option labels and keywords are things they would type having seen the control
 * but not the row; the description, section and control are context that should
 * only surface a row when nothing better matched.
 *
 * A prefix match on the same field scores below a whole-word match on it, so
 * typing "stor" surfaces "Storage" ahead of a description that happens to
 * mention "restore". `SCORE` is a total order; nothing here is a tie by design.
 */
const SCORE: Readonly<Record<SettingFieldKind, number>> = {
  id: 100,
  title: 80,
  option: 60,
  font: 58,
  keyword: 50,
  desc: 30,
  section: 20,
  control: 15,
};

/** Points added when a token matches the start of a word. */
const PREFIX_BONUS = 10;

/**
 * How a single token matched one field.
 *
 * Returns `null` when the token is absent from the field entirely. `start` and
 * `end` are offsets into the field's original text, which is what makes
 * highlighting correct in the presence of accents.
 *
 * Only whole-word and word-prefix matches count. Mid-word substring matching was
 * tried and removed: it let `nterfac` reach `interface` and `sego` reach
 * `segoe`, and neither is a query anyone types. Prefix matching already covers
 * the truncation case that matters — `dyslex` reaches `dyslexic`, `interv`
 * reaches `InterVariable` — so the extra branch bought noise and nothing else.
 */
function matchField(
  field: SettingIndexField,
  token: string
): { score: number; start: number; end: number } | null {
  // The id is compared whole, before word matching, so that "font-family"
  // outranks every setting that merely contains the word "family".
  if (field.kind === "id") {
    const whole = foldWords(field.text);
    const full = whole.map((w) => w.text).join("");
    if (full === token) {
      return { score: SCORE.id, start: 0, end: field.text.length };
    }
    if (full.startsWith(token)) {
      const first = whole[0];
      if (!first) return null;
      const start = field.text.indexOf(first.text);
      return {
        score: SCORE.id - 1,
        start,
        end: start + token.length,
      };
    }
  }

  let best: { score: number; start: number; end: number } | null = null;
  for (const word of field.words) {
    let candidate: { score: number; start: number; end: number } | null = null;
    if (word.text === token) {
      candidate = {
        score: SCORE[field.kind],
        start: word.start,
        end: word.end,
      };
    } else if (word.text.startsWith(token)) {
      candidate = {
        score: SCORE[field.kind] - PREFIX_BONUS,
        start: word.start,
        end: word.start + token.length,
      };
    }
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function field(kind: SettingFieldKind, text: string): SettingIndexField {
  return { kind, text, words: foldWords(text) };
}

/**
 * Build the index.
 *
 * `sectionLabels` maps a section id to its resolved nav label, passed in rather
 * than imported so this module stays independent of the registry's shape.
 *
 * A setting missing an optional field simply contributes fewer entries — an
 * index with no options indexed is correct for a switch, not a degraded one.
 */
export function buildSettingIndex(
  settings: readonly IndexableSetting[],
  sectionLabels: Readonly<Record<string, string>>,
  t: Translate
): SettingIndexEntry[] {
  return settings.map((setting) => {
    const fields: SettingIndexField[] = [
      field("id", setting.id),
      field("title", t(setting.titleKey)),
      field("desc", t(setting.descKey)),
      field("control", setting.control),
      field("section", sectionLabels[setting.section] ?? setting.section),
    ];

    for (const keyword of setting.keywords ?? []) {
      fields.push(field("keyword", keyword));
    }

    for (const option of setting.options ?? []) {
      fields.push(field("option", t(option.labelKey)));
      const family = setting.optionFonts?.[option.value];
      if (family) fields.push(field("font", family));
    }

    return { id: setting.id, section: setting.section, fields };
  });
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * Rank indexed settings against a query.
 *
 * Multi-token: every token must match, in at least one field each. That is what
 * makes "open dyslexic" resolve to the single option label "OpenDyslexic" —
 * under whole-query substring matching neither token pair exists as a
 * substring, so it returned nothing.
 *
 * The entry's score is the sum of its per-token bests, so matching more tokens
 * beats matching one token harder.
 *
 * Returns `[]` for an empty query, and for a query that is only punctuation —
 * callers render "show everything" on the first and must not treat the second
 * as "everything matches".
 */
export function searchSettingIndex(
  index: readonly SettingIndexEntry[],
  query: string
): SettingMatch[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const matches: SettingMatch[] = [];

  for (const entry of index) {
    let total = 0;
    let matchedAll = true;
    const hits: SettingHit[] = [];
    // Resolved once so the highlight check below does not re-scan the fields.
    const title = entry.fields.find((f) => f.kind === "title");

    for (const token of tokens) {
      let best: {
        score: number;
        kind: SettingFieldKind;
        start: number;
        end: number;
      } | null = null;

      for (const f of entry.fields) {
        const m = matchField(f, token);
        if (m && (!best || m.score > best.score)) {
          best = { ...m, kind: f.kind };
        }
      }

      if (!best) {
        matchedAll = false;
        break;
      }
      total += best.score;

      // Highlighting asks a different question from ranking. Ranking asks
      // "which field matches this token most strongly"; highlighting asks "does
      // the text this row actually renders contain it". The two routinely
      // disagree: querying `confetti` wins on the *id* of the confetti setting,
      // so a highlight derived from the winning field would leave the row
      // unmarked even though its title plainly contains the word. The title is
      // therefore checked independently of which field took the score.
      if (title) {
        const inTitle = matchField(title, token);
        if (inTitle) {
          hits.push({
            kind: "title",
            start: inTitle.start,
            end: inTitle.end,
          });
        }
      }
    }

    if (matchedAll) matches.push({ entry, score: total, hits });
  }

  return matches.sort(
    (a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)
  );
}
