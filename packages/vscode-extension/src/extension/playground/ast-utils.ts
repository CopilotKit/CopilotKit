/**
 * Shared AST utilities for the playground scanner. Keeps offset-math and
 * location conversion logic in one place so `find-copilotkit.ts` and
 * `walk-ancestors.ts` produce consistent line/column values.
 */

/**
 * Pre-computes line-start offsets for O(log n) offset→line/column conversion.
 */
export function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Converts a byte offset into a 1-based line and 0-based column.
 * Expects `lineOffsets` produced by `buildLineOffsets`.
 */
export function offsetToLineColumn(
  offset: number,
  lineOffsets: number[],
): { line: number; column: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineOffsets[lo]! };
}

/**
 * Converts a 1-based line and 0-based column into a byte offset.
 * Linear scan — O(offset). For many conversions against the same source,
 * prefer buildLineOffsets + binary search or a higher-level API.
 */
export function lineColumnToOffset(
  line: number,
  column: number,
  source: string,
): number {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line && offset < source.length) {
    if (source.charCodeAt(offset) === 10) currentLine++;
    offset++;
  }
  return offset + column;
}
