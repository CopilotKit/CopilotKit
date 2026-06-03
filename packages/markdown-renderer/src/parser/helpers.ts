import type { StreamingMarkdownParserOptions } from './types';
import type { SourceLine } from './internal';

/**
 * Default parser options for streaming markdown.
 */
export const DEFAULT_OPTIONS: StreamingMarkdownParserOptions = {
  segmenter: true,
  enableTables: true,
  enableAutolinks: true,
};

/**
 * Merges user-provided parser options with defaults.
 *
 * @param options - Optional partial parser options.
 * @returns Fully populated parser options.
 */
export function normalizeOptions(
  options: Partial<StreamingMarkdownParserOptions> | undefined,
): StreamingMarkdownParserOptions {
  return {
    segmenter: options?.segmenter ?? DEFAULT_OPTIONS.segmenter,
    enableTables: options?.enableTables ?? DEFAULT_OPTIONS.enableTables,
    enableAutolinks:
      options?.enableAutolinks ?? DEFAULT_OPTIONS.enableAutolinks,
  };
}

/**
 * Normalizes streaming input chunks by handling trailing carriage-return boundaries.
 *
 * @param chunk - Incoming raw chunk.
 * @param hadPendingCR - Whether the previous chunk ended with `\\r`.
 * @returns Normalized text and whether this chunk now ends with a pending `\\r`.
 */
export function normalizeChunk(
  chunk: string,
  hadPendingCR: boolean,
): { text: string; pendingCarriageReturn: boolean } {
  const input = (hadPendingCR ? '\r' : '') + chunk;
  const pendingCarriageReturn = input.endsWith('\r');
  const head = pendingCarriageReturn ? input.slice(0, -1) : input;

  return {
    text: head.replace(/\r\n?/g, '\n'),
    pendingCarriageReturn,
  };
}

/**
 * Splits normalized source text into lines with source offsets.
 *
 * @param source - Normalized source text.
 * @returns Line descriptors preserving absolute ranges.
 */
export function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '\n') {
      continue;
    }

    lines.push({
      text: source.slice(start, i),
      start,
      end: i + 1,
      hasNewline: true,
    });
    start = i + 1;
  }

  if (start < source.length || source.length === 0) {
    lines.push({
      text: source.slice(start),
      start,
      end: source.length,
      hasNewline: false,
    });
  }

  return lines;
}

/**
 * Returns the trailing unterminated line text.
 *
 * @param source - Full source text.
 * @returns Last line content after the final newline.
 */
export function getLineBuffer(source: string): string {
  const newline = source.lastIndexOf('\n');
  return newline < 0 ? source : source.slice(newline + 1);
}

/**
 * Converts an absolute source index to 1-based line/column.
 *
 * @param source - Source text.
 * @param index - Absolute index.
 * @returns 1-based line and column coordinates.
 */
export function toLineColumn(
  source: string,
  index: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

/**
 * Returns true for blank lines.
 */
export function isBlank(value: string): boolean {
  return /^\s*$/.test(value);
}

/**
 * Returns true when a line is a citation definition.
 */
export function isCitationDefinitionLine(value: string): boolean {
  return /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.test(value);
}

/**
 * Returns true when a line is an unfinished citation-definition prefix candidate.
 *
 * This enables optimistic streaming behavior for definition lines that begin with
 * `[^` but are not yet complete enough to classify as either:
 * 1) a valid citation definition, or
 * 2) plain paragraph text.
 *
 * @param value - Raw line text.
 * @param hasNewline - Whether the source line is newline-terminated.
 * @param isComplete - Whether the parser has been finalized.
 */
export function isCitationDefinitionPrefixCandidate(
  value: string,
  hasNewline: boolean,
  isComplete: boolean,
): boolean {
  if (hasNewline || isComplete || isCitationDefinitionLine(value)) {
    return false;
  }

  return (
    /^\s{0,3}\[\^[^\]\s]*$/.test(value) || /^\s{0,3}\[\^[^\]\s]+\]$/.test(value)
  );
}

/**
 * Matches an opening fenced code block marker.
 */
export function matchFenceOpen(
  value: string,
): { marker: '```' | '~~~'; length: number; info: string } | null {
  const trimmed = value.trimStart();
  const backtick = /^(`{3,})(.*)$/.exec(trimmed);
  if (backtick) {
    return {
      marker: '```',
      length: backtick[1].length,
      info: backtick[2].trim(),
    };
  }

  const tilde = /^(~{3,})(.*)$/.exec(trimmed);
  if (tilde) {
    return {
      marker: '~~~',
      length: tilde[1].length,
      info: tilde[2].trim(),
    };
  }

  return null;
}

/**
 * Matches a valid fenced code block closing line.
 */
export function matchFenceClose(
  value: string,
  marker: '```' | '~~~',
  length: number,
): boolean {
  const re = marker === '```' ? /^\s*`{3,}\s*$/ : /^\s*~{3,}\s*$/;
  if (!re.test(value)) {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length >= length;
}

/**
 * Matches ATX heading syntax and extracts heading metadata.
 */
export function matchAtxHeading(
  value: string,
): {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  contentOffset: number;
} | null {
  const match = /^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    level: match[1].length as 1 | 2 | 3 | 4 | 5 | 6,
    text: match[2],
    contentOffset: value.indexOf(match[2]),
  };
}

/**
 * Returns true for setext heading underline lines.
 */
export function isSetextUnderline(value: string): boolean {
  return /^\s{0,3}(=+|-+)\s*$/.test(value);
}

/**
 * Returns true for thematic break syntax.
 */
export function isThematicBreak(value: string): boolean {
  return /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(value);
}

/**
 * Matches ordered and unordered list-item markers.
 */
export function matchListItem(value: string): {
  ordered: boolean;
  start: number;
  content: string;
  indent: number;
  contentIndent: number;
} | null {
  const unordered = /^(\s{0,3})([-+*])(\s+)(.*)$/.exec(value);
  if (unordered) {
    const indent = unordered[1].length;
    const contentIndent = indent + unordered[2].length + unordered[3].length;
    return {
      ordered: false,
      start: 1,
      content: unordered[4],
      indent,
      contentIndent,
    };
  }

  const ordered = /^(\s{0,3})(\d{1,9})([.)])(\s+)(.*)$/.exec(value);
  if (ordered) {
    const indent = ordered[1].length;
    const markerLength = ordered[2].length + ordered[3].length;
    const contentIndent = indent + markerLength + ordered[4].length;
    return {
      ordered: true,
      start: Number(ordered[2]),
      content: ordered[5],
      indent,
      contentIndent,
    };
  }

  return null;
}

/**
 * Returns true for blockquote marker lines.
 */
export function isBlockquoteLine(value: string): boolean {
  return /^\s{0,3}>\s?/.test(value);
}

/**
 * Returns true when two lines form a GFM table header + divider pair.
 */
export function isPipeTableHeader(
  first: SourceLine,
  second: SourceLine,
): boolean {
  return looksLikeTableRow(first.text) && isTableDividerRow(second.text);
}

/**
 * Returns true when a line appears to be a table row.
 */
export function looksLikeTableRow(value: string): boolean {
  return value.includes('|') && /\S/.test(value.replace(/\|/g, ''));
}

/**
 * Returns true for GFM table divider rows.
 */
export function isTableDividerRow(value: string): boolean {
  const cells = splitTableCells(value);
  if (cells.length === 0) {
    return false;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * Splits a pipe-table row into trimmed cell values.
 */
export function splitTableCells(value: string): string[] {
  const trimmed = value.trim();
  const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const core = body.endsWith('|') ? body.slice(0, -1) : body;
  return core.split('|').map((cell) => cell.trim());
}

/**
 * Converts table divider cells into alignment metadata.
 */
export function parseTableAlignment(
  cells: string[],
): Array<'left' | 'right' | 'center' | 'none'> {
  return cells.map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');

    if (left && right) {
      return 'center';
    }
    if (left) {
      return 'left';
    }
    if (right) {
      return 'right';
    }

    return 'none';
  });
}

/**
 * Determines whether a line starts a new block construct.
 */
export function startsNewBlock(
  lines: SourceLine[],
  index: number,
  enableTables: boolean,
): boolean {
  const line = lines[index].text;

  return (
    !!matchFenceOpen(line) ||
    !!matchAtxHeading(line) ||
    isThematicBreak(line) ||
    !!matchListItem(line) ||
    isBlockquoteLine(line) ||
    (enableTables &&
      index + 1 < lines.length &&
      isPipeTableHeader(lines[index], lines[index + 1]))
  );
}

/**
 * Returns true when a character is escapable in CommonMark inline syntax.
 */
export function isEscapable(ch: string): boolean {
  return /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(ch);
}

/**
 * Finds the matching closing delimiter for a nested delimiter pair.
 */
export function findClosing(
  input: string,
  openAt: number,
  openChar: '[' | '(',
  closeChar: ']' | ')',
): number {
  let depth = 0;
  for (let i = openAt; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }

    if (ch === openChar) {
      depth += 1;
      continue;
    }

    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Parses a markdown link destination and optional title.
 */
export function parseLinkDestination(input: string): {
  url: string;
  title?: string;
} {
  const trimmed = input.trim();

  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    if (close > 0) {
      const url = trimmed.slice(1, close);
      const rest = trimmed.slice(close + 1).trim();
      const title = parseLinkTitle(rest);
      return title ? { url, title } : { url };
    }
  }

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 0) {
    return { url: trimmed };
  }

  const url = trimmed.slice(0, firstSpace);
  const title = parseLinkTitle(trimmed.slice(firstSpace).trim());

  return title ? { url, title } : { url };
}

/**
 * Parses CommonMark-style link titles (`\"...\"`, `'...'`, `( ... )`).
 */
export function parseLinkTitle(input: string): string | undefined {
  if (!input) {
    return undefined;
  }

  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1);
  }

  if (input.startsWith('(') && input.endsWith(')')) {
    return input.slice(1, -1);
  }

  return undefined;
}

/**
 * Returns true for URL-shaped text supported by autolink detection.
 */
export function isUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/.test(value);
}

/**
 * Returns true for email-shaped text supported by autolink detection.
 */
export function isEmail(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

/**
 * Trims punctuation suffixes from autolink candidates.
 */
export function trimAutolinkTrailingPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && /[.,;:!?]/.test(value[end - 1])) {
    end -= 1;
  }

  let candidate = value.slice(0, end);
  if (candidate.endsWith(')')) {
    const open = (candidate.match(/\(/g) ?? []).length;
    const close = (candidate.match(/\)/g) ?? []).length;
    if (close > open) {
      candidate = candidate.slice(0, -1);
    }
  }

  return candidate;
}
