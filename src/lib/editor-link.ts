/**
 * URL handling for the editor's insert-link form.
 *
 * The form accepts hand-typed domains as well as full URLs. Keeping that
 * decision in a pure helper makes it testable without a Plate editor, and keeps
 * the dangerous-scheme case explicit: an unknown scheme is never handed back
 * as a link target.
 */

const ALLOWED_SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

/**
 * Normalize what the user typed into a safe href, or `null` when there is no
 * link to insert. Anything that is not an allowed scheme is treated as a
 * hostname, so `javascript:alert(1)` becomes an https URL instead of executing.
 */
export function normalizeEditorLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (ALLOWED_SCHEME.test(value)) return value;
  return `https://${value}`;
}
