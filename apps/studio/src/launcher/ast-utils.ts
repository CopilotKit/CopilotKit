/**
 * Shared AST utilities. Mirrors
 * .chalk/references/vscode-extension/src/extension/playground/ast-utils.ts —
 * keeps offset-math and line/column conversion logic in one place so the
 * scanner and the enclosing-component lookup produce consistent values.
 *
 * Offsets in this module are byte offsets into the source string (matching
 * what `oxc-parser` emits on every node's `.start` / `.end`).
 */

/**
 * Pre-compute line-start offsets for O(log n) offset → line/column
 * conversion. Index `i` of the result is the byte offset where line `i+1`
 * starts.
 */
export function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Convert a byte offset into a 1-based line number and 0-based column.
 * Matches the convention oxc-parser uses on its `loc` fields when present,
 * and what most editors expect.
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
