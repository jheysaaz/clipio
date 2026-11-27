/**
 * Pure window arithmetic for the popup's snippet list.
 *
 * The library can hold thousands of snippets, but only the rows inside the
 * sidebar viewport — plus a small overscan — need to exist in the DOM. This
 * module holds the arithmetic so the component has no branches to hide from
 * tests and the boundaries can be checked without a browser.
 */

export type VirtualRange = {
  /** Index of the first item to render, inclusive. */
  start: number;
  /** Index after the last item to render, exclusive. */
  end: number;
  /** Height in px above the rendered slice. */
  paddingTop: number;
  /** Height in px below the rendered slice. */
  paddingBottom: number;
};

/**
 * The slice of `itemCount` rows that covers `scrollTop..scrollTop + viewportHeight`.
 *
 * `overscan` adds rows on both sides so a fast scroll does not flash empty
 * space while React commits the next slice. Clamping at both ends matters: a
 * negative scrollTop or a viewport taller than the list must not ask for rows
 * that do not exist, and an empty list has a zero-height slice.
 */
export function virtualRange(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 4
): VirtualRange {
  if (itemCount <= 0 || rowHeight <= 0 || viewportHeight <= 0 || overscan < 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }

  const first = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan
  );
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(itemCount, first + visibleRows);

  return {
    start: first,
    end,
    paddingTop: first * rowHeight,
    paddingBottom: (itemCount - end) * rowHeight,
  };
}

/**
 * Scroll position that brings `index` fully into view, centred when it is far
 * outside the window. Returns `null` when the row is already visible.
 *
 * The row's own height and any fixed header (the create draft preview) are
 * included so the caller can assign the result to `scrollTop` directly.
 */
export function scrollTopForRow(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  headerHeight = 0
): number | null {
  if (index < 0 || rowHeight <= 0 || viewportHeight <= 0) return null;

  const top = headerHeight + index * rowHeight;
  const bottom = top + rowHeight;
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return null;

  return Math.max(0, top - (viewportHeight - rowHeight) / 2);
}
