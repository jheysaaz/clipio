/**
 * Pure resize maths for the editor's media placeholders.
 *
 * Split out of `ResizableMediaWrapper.tsx` deliberately. The component imports
 * `i18n` from `#i18n`, a WXT virtual module with no alias in the unit-test
 * environment — so the component cannot be imported by a test at all. That is
 * why its test file used to import only `vitest`: it re-implemented the clamp
 * arithmetic and copied `MIN_WIDTH = 40` by hand with a comment saying it
 * "must match" the source. The component could have been deleted and every one
 * of those tests would still have passed.
 *
 * With the logic here, it is ordinary importable production code with no React
 * and no i18n, so it can be tested for what it is.
 */

/** Narrowest a dragged media element may become, in px. */
export const MIN_WIDTH = 40;

/** Width assumed when there is no scrollable ancestor to measure, in px. */
export const FALLBACK_MAX_WIDTH = 600;

/**
 * Clamp a drag to the allowed width range.
 *
 * This used to be written out inline in both the mousemove and the mouseup
 * handler, so the two could drift apart during a live drag.
 */
export function clampWidth(
  startWidth: number,
  delta: number,
  maxWidth: number
): number {
  return Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta));
}

/**
 * Walk up the DOM from `el` to find the nearest scrollable ancestor
 * (overflow-auto / overflow-scroll). This is the PlateContent container whose
 * clientWidth is the true maximum we must not exceed.
 */
export function getScrollParentWidth(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const { overflow, overflowX } = getComputedStyle(node);
    if (/auto|scroll/.test(overflow) || /auto|scroll/.test(overflowX)) {
      return node.clientWidth;
    }
    node = node.parentElement;
  }
  // Fallback: use the direct parent's offsetWidth
  return el.parentElement?.offsetWidth ?? FALLBACK_MAX_WIDTH;
}
