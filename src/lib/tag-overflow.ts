/**
 * Decide how many tag chips fit on one footer row.
 *
 * The last slot is reserved for the `+N` chip when any tags are hidden, so a
 * row never has to wrap to show the overflow control.
 */
export function visibleTagCount(
  tagWidths: readonly number[],
  moreWidth: number,
  availableWidth: number,
  gap = 6
): number {
  if (availableWidth <= 0 || tagWidths.length === 0) return tagWidths.length;

  const widthWithOverflow = (count: number): number => {
    const chipWidth = tagWidths
      .slice(0, count)
      .reduce((total, width) => total + width, 0);
    const chipGaps = count > 0 ? (count - 1) * gap : 0;
    const hidden = tagWidths.length - count;
    return chipWidth + chipGaps + (hidden > 0 ? gap + moreWidth : 0);
  };

  for (let count = tagWidths.length; count >= 0; count -= 1) {
    if (widthWithOverflow(count) <= availableWidth) return count;
  }
  return 0;
}
