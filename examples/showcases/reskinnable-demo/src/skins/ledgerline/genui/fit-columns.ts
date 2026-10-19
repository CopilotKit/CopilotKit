/**
 * Column priority for a wide table in a narrow chat column (the reskin
 * shell's wide-table pattern). Each column has a minimum width and a priority
 * (1 = never hidden). Columns are taken in priority order while they fit the
 * measured width, then returned in their original order; the rest go to the
 * row's expandable detail instead of scrolling sideways.
 */

export interface FitColumn {
  key: string;
  minWidth: number;
  priority: number;
}

export function fitColumns<C extends FitColumn>(
  columns: readonly C[],
  containerWidth: number,
  reserve = 0,
): { visible: C["key"][]; hidden: C["key"][] } {
  const budget = Math.max(0, containerWidth - reserve);
  const ranked = columns
    .map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.priority - b.c.priority || a.index - b.index);
  const keep = new Set<string>();
  let used = 0;
  for (const { c } of ranked) {
    if (c.priority <= 1 || used + c.minWidth <= budget) {
      keep.add(c.key);
      used += c.minWidth;
    } else {
      break;
    }
  }
  return {
    visible: columns.filter((c) => keep.has(c.key)).map((c) => c.key),
    hidden: columns.filter((c) => !keep.has(c.key)).map((c) => c.key),
  };
}
