/**
 * Types shared across all import/export format parsers.
 */

import type { Snippet } from "~/types";

/** Supported import formats. */
export type FormatId = "clipio" | "textblaze" | "powertext";

/**
 * A snippet parsed from an external format, before it is converted to a
 * full Clipio Snippet. Contains all the information needed to perform
 * conflict detection and user review.
 */
export interface ParsedSnippet {
  /** Suggested ID — may collide with existing snippets. */
  suggestedId: string;
  label: string;
  shortcut: string;
  /** Clipio markdown content — ready to store. */
  content: string;
  tags: string[];
  /** Any placeholder tokens from the source format that we couldn't map. */
  unsupportedPlaceholders: string[];
}

/** Result returned by a format parser. */
export interface ParseResult {
  format: FormatId;
  snippets: ParsedSnippet[];
}

/** Interface all format parsers must implement. */
export interface FormatParser {
  readonly id: FormatId;
  /** Human-readable name shown in the UI. */
  readonly displayName: string;
  /** Optional path to a small icon image (relative to extension root or data URL). */
  readonly iconUrl?: string;
  /** Returns true if this parser thinks it can handle the given JSON object. */
  canParse(raw: unknown): boolean;
  /** Parse the raw JSON into ParsedSnippets. */
  parse(raw: unknown): ParsedSnippet[];
}

// ---------------------------------------------------------------------------
// Conflict types
// ---------------------------------------------------------------------------

export type ConflictResolution =
  | "skip" // Don't import this snippet at all
  | "overwrite" // Replace the existing snippet
  | "rename"; // Keep both — auto-rename the incoming shortcut

export interface ConflictEntry {
  incoming: ParsedSnippet;
  /** The existing snippet that conflicts (by id or shortcut). */
  existing: Snippet;
  /** Which field(s) conflict. */
  conflictType: "id" | "shortcut" | "both";
  /** Resolution chosen by the user. */
  resolution: ConflictResolution;
  /** New shortcut to use when resolution === "rename". */
  renamedShortcut?: string;
}

// ---------------------------------------------------------------------------
// Unsupported placeholder choice
// ---------------------------------------------------------------------------

export type UnsupportedPlaceholderAction =
  | "keep" // Keep the placeholder as literal text (default)
  | "remove" // Remove the placeholder entirely
  | "skip"; // Skip importing this snippet

export interface UnsupportedPlaceholderEntry {
  snippet: ParsedSnippet;
  /** The action chosen by the user — one action applies to ALL unsupported placeholders in this snippet. */
  action: UnsupportedPlaceholderAction;
}
