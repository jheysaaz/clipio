/**
 * Escaping for cells of a Markdown pipe table.
 *
 * Shared by the HTML-to-Markdown converter and the editor's serializer: both
 * emit the same `| a | b |` syntax, and both had the same one-step escape.
 */

/**
 * Make one string safe as a pipe-table cell.
 *
 * A literal `|` has to become `\|` or it splits the cell. A backslash must be
 * doubled *first*: otherwise an input `\|` becomes `\\|`, which a Markdown
 * parser reads as a literal backslash followed by a live delimiter instead of
 * the backslash-plus-pipe the user typed. That missing first step is what
 * CodeQL flagged as incomplete string escaping.
 */
export function escapeMarkdownTableCell(cell: string): string {
  return cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
