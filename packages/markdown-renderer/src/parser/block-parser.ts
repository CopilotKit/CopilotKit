import {
  isBlank,
  isBlockquoteLine,
  isCitationDefinitionLine,
  isCitationDefinitionPrefixCandidate,
  isPipeTableHeader,
  isSetextUnderline,
  isThematicBreak,
  looksLikeTableRow,
  matchAtxHeading,
  matchFenceClose,
  matchFenceOpen,
  matchListItem,
  parseTableAlignment,
  splitTableCells,
  startsNewBlock,
} from './helpers';
import type {
  DraftNode,
  ParseContext,
  ParseResult,
  SourceLine,
} from './internal';
import { parseInline } from './inline-parser';

/**
 * Parses a contiguous range of source lines into block-level draft nodes.
 *
 * @param lines - Line-split source with offsets.
 * @param from - Inclusive start line index.
 * @param to - Exclusive end line index.
 * @param path - Stable path prefix for emitted nodes.
 * @param context - Shared parse context carrying options, warnings, and citations.
 * @param isRoot - Whether this parse call is for the document root.
 * @returns Root draft node plus updated immutable parse context.
 */
export function parseBlocks(
  lines: SourceLine[],
  from: number,
  to: number,
  path: string,
  context: ParseContext,
  isRoot: boolean,
): ParseResult<DraftNode> {
  let root: DraftNode = {
    path,
    type: 'document',
    range: {
      start: from < to ? lines[from].start : 0,
      end: from < to ? lines[to - 1].end : 0,
    },
    closed: false,
    props: {},
    children: [],
  };

  let i = from;
  let citations = context.citations;
  let warnings = context.warnings;
  let hasWarnedSegmenterUnavailable = context.hasWarnedSegmenterUnavailable;

  while (i < to) {
    const line = lines[i];
    const isCitationDefinition = isCitationDefinitionLine(line.text);
    const isCitationDefinitionPrefix = isCitationDefinitionPrefixCandidate(
      line.text,
      line.hasNewline,
      context.isComplete,
    );

    if (
      isBlank(line.text) ||
      isCitationDefinition ||
      isCitationDefinitionPrefix
    ) {
      i += 1;
      continue;
    }

    const fenced = matchFenceOpen(line.text);
    if (fenced) {
      const nodePath = `${path}.${root.children.length}`;
      const parsed = parseCodeFence(lines, i, to, nodePath, context, fenced);
      root.children = [...root.children, parsed.node];
      i = parsed.next;
      continue;
    }

    if (isBlockquoteLine(line.text)) {
      const nodePath = `${path}.${root.children.length}`;
      const parsed = parseBlockquote(lines, i, to, nodePath, {
        ...context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      });
      root.children = [...root.children, parsed.value];
      i = parsed.next;
      citations = parsed.citations;
      warnings = parsed.warnings;
      hasWarnedSegmenterUnavailable = parsed.hasWarnedSegmenterUnavailable;
      continue;
    }

    const listMarker = matchListItem(line.text);
    if (listMarker) {
      const nodePath = `${path}.${root.children.length}`;
      const parsed = parseList(
        lines,
        i,
        to,
        nodePath,
        {
          ...context,
          citations,
          warnings,
          hasWarnedSegmenterUnavailable,
        },
        listMarker.ordered,
      );
      root.children = [...root.children, parsed.value];
      i = parsed.next;
      citations = parsed.citations;
      warnings = parsed.warnings;
      hasWarnedSegmenterUnavailable = parsed.hasWarnedSegmenterUnavailable;
      continue;
    }

    const heading = matchAtxHeading(line.text);
    if (heading) {
      const nodePath = `${path}.${root.children.length}`;
      const children = parseInline(
        heading.text,
        line.start + heading.contentOffset,
        nodePath,
        {
          ...context,
          citations,
          warnings,
          hasWarnedSegmenterUnavailable,
        },
      );

      root.children = [
        ...root.children,
        {
          path: nodePath,
          type: 'heading',
          range: { start: line.start, end: line.end },
          closed: context.isComplete || line.hasNewline,
          props: { level: heading.level },
          children: children.value,
        },
      ];
      citations = children.citations;
      warnings = children.warnings;
      hasWarnedSegmenterUnavailable = children.hasWarnedSegmenterUnavailable;
      i += 1;
      continue;
    }

    if (
      i + 1 < to &&
      isSetextUnderline(lines[i + 1].text) &&
      !isBlank(line.text)
    ) {
      const nodePath = `${path}.${root.children.length}`;
      const level = lines[i + 1].text.trim().startsWith('=') ? 1 : 2;
      const children = parseInline(line.text, line.start, nodePath, {
        ...context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      });

      root.children = [
        ...root.children,
        {
          path: nodePath,
          type: 'heading',
          range: { start: line.start, end: lines[i + 1].end },
          closed: context.isComplete || lines[i + 1].hasNewline,
          props: { level },
          children: children.value,
        },
      ];
      citations = children.citations;
      warnings = children.warnings;
      hasWarnedSegmenterUnavailable = children.hasWarnedSegmenterUnavailable;
      i += 2;
      continue;
    }

    if (isThematicBreak(line.text)) {
      root.children = [
        ...root.children,
        {
          path: `${path}.${root.children.length}`,
          type: 'thematic-break',
          range: { start: line.start, end: line.end },
          closed: true,
          props: {},
          children: [],
        },
      ];
      i += 1;
      continue;
    }

    if (
      context.options.enableTables &&
      i + 1 < to &&
      isPipeTableHeader(lines[i], lines[i + 1])
    ) {
      const nodePath = `${path}.${root.children.length}`;
      const parsed = parsePipeTable(lines, i, to, nodePath, {
        ...context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      });
      root.children = [...root.children, parsed.value];
      i = parsed.next;
      citations = parsed.citations;
      warnings = parsed.warnings;
      hasWarnedSegmenterUnavailable = parsed.hasWarnedSegmenterUnavailable;
      continue;
    }

    const nodePath = `${path}.${root.children.length}`;
    const parsed = parseParagraph(lines, i, to, nodePath, {
      ...context,
      citations,
      warnings,
      hasWarnedSegmenterUnavailable,
    });
    root.children = [...root.children, parsed.value];
    i = parsed.next;
    citations = parsed.citations;
    warnings = parsed.warnings;
    hasWarnedSegmenterUnavailable = parsed.hasWarnedSegmenterUnavailable;
  }

  root = {
    ...root,
    closed:
      !isRoot ||
      context.isComplete ||
      (to > from &&
        lines[to - 1].hasNewline &&
        root.children.every((child) => child.closed)),
  };

  return {
    value: root,
    citations,
    warnings,
    hasWarnedSegmenterUnavailable,
  };
}

function parseCodeFence(
  lines: SourceLine[],
  from: number,
  to: number,
  path: string,
  context: ParseContext,
  fenceOpen: { marker: '```' | '~~~'; length: number; info: string },
): { node: DraftNode; next: number } {
  let i = from + 1;
  let closeLine = -1;

  while (i < to) {
    if (matchFenceClose(lines[i].text, fenceOpen.marker, fenceOpen.length)) {
      closeLine = i;
      break;
    }
    i += 1;
  }

  const endLine = closeLine >= 0 ? closeLine : to - 1;
  const textLines = lines.slice(from + 1, closeLine >= 0 ? closeLine : to);
  const text = textLines.map((line) => line.text).join('\n');
  const closed = closeLine >= 0 || context.isComplete;

  return {
    node: {
      path,
      type: 'code-block',
      range: { start: lines[from].start, end: lines[endLine].end },
      closed,
      props: {
        fence: fenceOpen.marker,
        ...(fenceOpen.info ? { info: fenceOpen.info.split(/\s+/)[0] } : {}),
        ...(fenceOpen.info.includes(' ')
          ? { meta: fenceOpen.info.slice(fenceOpen.info.indexOf(' ') + 1) }
          : {}),
        text,
      },
      children: [],
    },
    next: closeLine >= 0 ? closeLine + 1 : to,
  };
}

function parseBlockquote(
  lines: SourceLine[],
  from: number,
  to: number,
  path: string,
  context: ParseContext,
): ParseResult<DraftNode> & { next: number } {
  const picked: SourceLine[] = [];
  let i = from;

  while (i < to) {
    const line = lines[i];
    if (isBlank(line.text) && picked.length > 0) {
      picked.push(line);
      i += 1;
      continue;
    }

    if (
      isBlockquoteLine(line.text) ||
      (!isBlank(line.text) &&
        picked.length > 0 &&
        !startsNewBlock(lines, i, context.options.enableTables))
    ) {
      picked.push(line);
      i += 1;
      continue;
    }

    break;
  }

  const stripped = picked.map((line) => {
    const marker = /^(\s{0,3}>\s?)/.exec(line.text);
    const markerWidth = marker?.[1].length ?? 0;
    const text = marker ? line.text.slice(markerWidth) : line.text;
    const start = line.start + markerWidth;

    return {
      text,
      start,
      end: start + text.length,
      hasNewline: line.hasNewline,
    };
  });
  const children = parseBlocks(
    stripped,
    0,
    stripped.length,
    path,
    context,
    false,
  );

  return {
    value: {
      path,
      type: 'blockquote',
      range: { start: picked[0].start, end: picked[picked.length - 1].end },
      closed: context.isComplete || picked[picked.length - 1].hasNewline,
      props: {},
      children: children.value.children,
    },
    next: i,
    citations: children.citations,
    warnings: children.warnings,
    hasWarnedSegmenterUnavailable: children.hasWarnedSegmenterUnavailable,
  };
}

function parseList(
  lines: SourceLine[],
  from: number,
  to: number,
  path: string,
  context: ParseContext,
  ordered: boolean,
): ParseResult<DraftNode> & { next: number } {
  const items: DraftNode[] = [];
  let i = from;
  let sawBlankBetweenItems = false;
  let listStartNumber: number | null = null;
  let citations = context.citations;
  let warnings = context.warnings;
  let hasWarnedSegmenterUnavailable = context.hasWarnedSegmenterUnavailable;

  while (i < to) {
    const marker = matchListItem(lines[i].text);
    if (!marker || marker.ordered !== ordered) {
      break;
    }

    if (ordered && listStartNumber === null) {
      listStartNumber = marker.start;
    }

    const contentLines: SourceLine[] = [
      {
        ...lines[i],
        text: marker.content,
      },
    ];
    const contentIndent = marker.contentIndent;

    i += 1;
    let hadBlank = false;

    while (i < to) {
      const next = lines[i];
      const nextMarker = matchListItem(next.text);

      if (nextMarker) {
        break;
      }

      if (isBlank(next.text)) {
        hadBlank = true;
        contentLines.push(next);
        i += 1;

        if (i < to) {
          const afterBlank = matchListItem(lines[i].text);
          if (afterBlank) {
            sawBlankBetweenItems = true;
            break;
          }
        }

        continue;
      }

      const leadingWhitespace = /^\s*/.exec(next.text)?.[0].length ?? 0;
      if (leadingWhitespace < contentIndent) {
        break;
      }

      const continuation = next.text.slice(contentIndent);
      contentLines.push({ ...next, text: continuation });
      i += 1;
    }

    const paragraphText = contentLines
      .map((line) => line.text)
      .join('\n')
      .trimEnd();
    const itemPath = `${path}.${items.length}`;
    const parsedInline = parseInline(
      paragraphText,
      contentLines[0].start,
      `${itemPath}.0`,
      {
        ...context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      },
    );
    const paragraph: DraftNode = {
      path: `${itemPath}.0`,
      type: 'paragraph',
      range: {
        start: contentLines[0].start,
        end: contentLines[contentLines.length - 1].end,
      },
      closed:
        context.isComplete || contentLines[contentLines.length - 1].hasNewline,
      props: {},
      children: parsedInline.value,
    };

    items.push({
      path: itemPath,
      type: 'list-item',
      range: {
        start: contentLines[0].start,
        end: contentLines[contentLines.length - 1].end,
      },
      closed:
        context.isComplete || contentLines[contentLines.length - 1].hasNewline,
      props: {},
      children: [paragraph],
    });

    citations = parsedInline.citations;
    warnings = parsedInline.warnings;
    hasWarnedSegmenterUnavailable = parsedInline.hasWarnedSegmenterUnavailable;

    if (hadBlank) {
      sawBlankBetweenItems = true;
    }
  }

  return {
    value: {
      path,
      type: 'list',
      range: {
        start: lines[from].start,
        end: lines[Math.max(from, i - 1)].end,
      },
      closed: context.isComplete || lines[Math.max(from, i - 1)].hasNewline,
      props: {
        ordered,
        start: ordered ? (listStartNumber ?? 1) : null,
        tight: !sawBlankBetweenItems,
      },
      children: items,
    },
    next: i,
    citations,
    warnings,
    hasWarnedSegmenterUnavailable,
  };
}

function parsePipeTable(
  lines: SourceLine[],
  from: number,
  to: number,
  path: string,
  context: ParseContext,
): ParseResult<DraftNode> & { next: number } {
  const header = splitTableCells(lines[from].text);
  const align = parseTableAlignment(splitTableCells(lines[from + 1].text));

  const rows: string[][] = [];
  let i = from + 2;
  while (i < to && looksLikeTableRow(lines[i].text)) {
    rows.push(splitTableCells(lines[i].text));
    i += 1;
  }

  let citations = context.citations;
  let warnings = context.warnings;
  let hasWarnedSegmenterUnavailable = context.hasWarnedSegmenterUnavailable;

  const headerChildren: DraftNode[] = [];
  for (let cellIndex = 0; cellIndex < header.length; cellIndex += 1) {
    const parsed = parseInline(
      header[cellIndex],
      lines[from].start,
      `${path}.0.${cellIndex}`,
      {
        ...context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      },
    );

    headerChildren.push({
      path: `${path}.0.${cellIndex}`,
      type: 'table-cell',
      range: { start: lines[from].start, end: lines[from].end },
      closed: true,
      props: {},
      children: parsed.value,
    });

    citations = parsed.citations;
    warnings = parsed.warnings;
    hasWarnedSegmenterUnavailable = parsed.hasWarnedSegmenterUnavailable;
  }

  const headerRow: DraftNode = {
    path: `${path}.0`,
    type: 'table-row',
    range: { start: lines[from].start, end: lines[from].end },
    closed: true,
    props: { isHeader: true },
    children: headerChildren,
  };

  const bodyRows: DraftNode[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const cellNodes: DraftNode[] = [];
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const parsed = parseInline(
        row[cellIndex],
        lines[from + 2 + rowIndex].start,
        `${path}.${rowIndex + 1}.${cellIndex}`,
        {
          ...context,
          citations,
          warnings,
          hasWarnedSegmenterUnavailable,
        },
      );

      cellNodes.push({
        path: `${path}.${rowIndex + 1}.${cellIndex}`,
        type: 'table-cell',
        range: {
          start: lines[from + 2 + rowIndex].start,
          end: lines[from + 2 + rowIndex].end,
        },
        closed: true,
        props: {},
        children: parsed.value,
      });

      citations = parsed.citations;
      warnings = parsed.warnings;
      hasWarnedSegmenterUnavailable = parsed.hasWarnedSegmenterUnavailable;
    }

    bodyRows.push({
      path: `${path}.${rowIndex + 1}`,
      type: 'table-row',
      range: {
        start: lines[from + 2 + rowIndex].start,
        end: lines[from + 2 + rowIndex].end,
      },
      closed: true,
      props: { isHeader: false },
      children: cellNodes,
    });
  }

  return {
    value: {
      path,
      type: 'table',
      range: { start: lines[from].start, end: lines[i - 1].end },
      closed: context.isComplete || lines[i - 1].hasNewline,
      props: { align },
      children: [headerRow, ...bodyRows],
    },
    next: i,
    citations,
    warnings,
    hasWarnedSegmenterUnavailable,
  };
}

function parseParagraph(
  lines: SourceLine[],
  from: number,
  to: number,
  path: string,
  context: ParseContext,
): ParseResult<DraftNode> & { next: number } {
  const picked: SourceLine[] = [];
  let i = from;

  while (i < to) {
    if (isBlank(lines[i].text)) {
      break;
    }

    if (
      picked.length > 0 &&
      startsNewBlock(lines, i, context.options.enableTables)
    ) {
      break;
    }

    if (
      isCitationDefinitionLine(lines[i].text) ||
      isCitationDefinitionPrefixCandidate(
        lines[i].text,
        lines[i].hasNewline,
        context.isComplete,
      )
    ) {
      break;
    }

    picked.push(lines[i]);
    i += 1;
  }

  const text = picked.map((line) => line.text).join('\n');
  const children = parseInline(text, picked[0].start, path, context);

  return {
    value: {
      path,
      type: 'paragraph',
      range: { start: picked[0].start, end: picked[picked.length - 1].end },
      closed: context.isComplete || picked[picked.length - 1].hasNewline,
      props: {},
      children: children.value,
    },
    next: i,
    citations: children.citations,
    warnings: children.warnings,
    hasWarnedSegmenterUnavailable: children.hasWarnedSegmenterUnavailable,
  };
}
