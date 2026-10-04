/**
 * The canonical, ordered list of import parsers.
 *
 * Two places need "every format Clipio can import, in the order we show them":
 * the import wizard (which one is handling this file) and the options page's
 * supported-formats row (which formats to advertise).
 *
 * They used to disagree. `ImportWizard` held a `PARSERS` map while
 * `LibraryPanel` carried its own hand-written array of `{ label, icon }` pairs
 * with the icon paths spelled out as string literals. Adding a format meant
 * editing two files, and forgetting the second produced a wizard that could
 * import a format the options page claimed was unsupported — the exact kind of
 * drift `docs/decisions/0007-tests-are-the-specification.md` exists to prevent.
 *
 * Order is presentation, so it lives here, next to the parsers, rather than in
 * either consumer.
 */

import { ClipioParser } from "./clipio";
import { TextBlazeParser } from "./textblaze";
import { PowerTextParser } from "./powertext";
import type { FormatId, FormatParser } from "./types";

/**
 * Every supported parser, in the order the UI lists them.
 *
 * `iconUrl` is optional on `FormatParser` because not every format necessarily
 * has a mark; consumers must handle its absence rather than assume it. All
 * three current formats do have one.
 */
export const IMPORT_PARSERS: readonly FormatParser[] = [
  ClipioParser,
  TextBlazeParser,
  PowerTextParser,
];

/** Look up a parser by its format id. */
export function getParser(id: FormatId): FormatParser | undefined {
  return IMPORT_PARSERS.find((parser) => parser.id === id);
}
