import { parseBlocks } from './block-parser';
import { parseCitationDefinitions } from './citations';
import {
  getLineBuffer,
  normalizeChunk,
  normalizeOptions,
  splitLines,
  toLineColumn,
} from './helpers';
import { applyAstOps, createAstOpsFromDraft } from './ops';
import type {
  StreamingMarkdownAstNode,
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserState,
  ParseMode,
} from './types';

/**
 * Creates a new streaming markdown parser state.
 *
 * @param options - Optional parser option overrides.
 * @returns New immutable parser state.
 * @public
 */
export function createStreamingMarkdownParserState(
  options?: Partial<StreamingMarkdownParserOptions>,
): StreamingMarkdownParserState {
  const normalizedOptions = normalizeOptions(options);
  const documentNode = {
    id: 1,
    type: 'document' as const,
    parentId: null,
    closed: false,
    range: { start: 0, end: 0 },
    children: [],
  };

  return {
    nextId: 2,
    nodes: [documentNode],
    rootId: 1,
    stack: [1],
    mode: 'block',
    warnings: [],
    citations: {
      order: [],
      numbers: {},
      definitions: {},
    },
    lineBuffer: '',
    isComplete: false,
    index: 0,
    line: 1,
    column: 1,
    options: normalizedOptions,
    source: '',
    pathToId: { '0': 1 },
    pendingCarriageReturn: false,
    hasWarnedSegmenterUnavailable: false,
  };
}

/**
 * Parses a streaming chunk and returns the next immutable parser state.
 *
 * @param state - Current parser state.
 * @param chunk - Incoming text chunk.
 * @returns Updated parser state.
 * @public
 */
export function parseStreamingMarkdownChunk(
  state: StreamingMarkdownParserState,
  chunk: string,
): StreamingMarkdownParserState {
  const normalized = normalizeChunk(chunk, state.pendingCarriageReturn);
  const source = state.source + normalized.text;

  return rebuildState(state, {
    source,
    isComplete: false,
    pendingCarriageReturn: normalized.pendingCarriageReturn,
  });
}

/**
 * Finalizes parsing by closing any provisional nodes and flushing trailing CR.
 *
 * @param state - Current parser state.
 * @returns Final parser state.
 * @public
 */
export function finalizeStreamingMarkdown(
  state: StreamingMarkdownParserState,
): StreamingMarkdownParserState {
  if (state.isComplete) {
    return state;
  }

  const source = state.source + (state.pendingCarriageReturn ? '\n' : '');

  return rebuildState(state, {
    source,
    isComplete: true,
    pendingCarriageReturn: false,
  });
}

function rebuildState(
  prev: StreamingMarkdownParserState,
  input: {
    source: string;
    isComplete: boolean;
    pendingCarriageReturn: boolean;
  },
): StreamingMarkdownParserState {
  const definitions = parseCitationDefinitions(input.source);
  const parseContext = {
    options: prev.options,
    warnings: definitions.warnings,
    citations: definitions.citations,
    isComplete: input.isComplete,
    hasWarnedSegmenterUnavailable: prev.hasWarnedSegmenterUnavailable,
  };

  const lines = splitLines(input.source);
  const parsedBlocks = parseBlocks(
    lines,
    0,
    lines.length,
    '0',
    parseContext,
    true,
  );
  const ops = [
    { kind: 'set-warnings', warnings: parsedBlocks.warnings } as const,
    { kind: 'set-citations', citations: parsedBlocks.citations } as const,
    {
      kind: 'set-segmenter-warning-state',
      hasWarnedSegmenterUnavailable: parsedBlocks.hasWarnedSegmenterUnavailable,
    } as const,
    ...createAstOpsFromDraft(parsedBlocks.value),
  ];

  const reduced = applyAstOps({
    previousNodes: prev.nodes,
    previousPathToId: prev.pathToId,
    nextId: prev.nextId,
    ops,
  });

  const lineBuffer = getLineBuffer(input.source);
  const { line, column } = toLineColumn(input.source, input.source.length);

  return {
    ...prev,
    nextId: reduced.nextId,
    nodes: reduced.nodes,
    rootId: reduced.rootId,
    stack: computeOpenStack(reduced.nodes, reduced.rootId),
    mode: inferMode(reduced.nodes, reduced.rootId),
    warnings: reduced.warnings,
    citations: reduced.citations,
    lineBuffer,
    isComplete: input.isComplete,
    index: input.source.length,
    line,
    column,
    source: input.source,
    pathToId: reduced.pathToId,
    pendingCarriageReturn: input.pendingCarriageReturn,
    hasWarnedSegmenterUnavailable: reduced.hasWarnedSegmenterUnavailable,
  };
}

function computeOpenStack(nodes: StreamingMarkdownAstNode[], rootId: number): number[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const stack: number[] = [];

  let cursor: number | null = rootId;
  while (cursor != null) {
    const node = nodeById.get(cursor);
    if (!node || node.closed) {
      break;
    }

    stack.push(cursor);
    if (!('children' in node) || node.children.length === 0) {
      break;
    }

    const lastChild = node.children[node.children.length - 1];
    cursor = typeof lastChild === 'number' ? lastChild : null;
  }

  return stack;
}

function inferMode(
  nodes: StreamingMarkdownAstNode[],
  rootId: number | null,
): ParseMode {
  if (rootId == null) {
    return 'block';
  }

  const root = nodes.find((node) => node.id === rootId);
  if (!root || !('children' in root) || root.children.length === 0) {
    return 'block';
  }

  const lastChild = nodes.find(
    (node) => node.id === root.children[root.children.length - 1],
  );
  if (!lastChild || lastChild.closed) {
    return 'block';
  }

  if (lastChild.type === 'paragraph') {
    return 'paragraph';
  }
  if (lastChild.type === 'heading') {
    return 'heading';
  }
  if (lastChild.type === 'blockquote') {
    return 'blockquote';
  }
  if (lastChild.type === 'list-item') {
    return 'list-item';
  }
  if (lastChild.type === 'code-block') {
    return 'code-fence';
  }
  if (lastChild.type === 'table') {
    return 'table';
  }

  return 'block';
}
