import { parseBlocks } from './block-parser';
import { splitLines } from './helpers';
import type { ParseContext } from './internal';
import type { CitationState, StreamingMarkdownWarning } from './types';

function createContext(): ParseContext {
  const warnings: StreamingMarkdownWarning[] = [];
  const citations: CitationState = { order: [], numbers: {}, definitions: {} };

  return {
    options: { segmenter: false, enableTables: true, enableAutolinks: true },
    warnings,
    citations,
    isComplete: false,
    hasWarnedSegmenterUnavailable: false,
  };
}

test('parses major block types in one pass', () => {
  const source =
    '# H\n\nP\n\n```ts\nx\n```\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n\n---\n';
  const lines = splitLines(source);
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const root = rootResult.value;

  const kinds = root.children.map((node) => node.type);

  expect(kinds).toContain('heading');
  expect(kinds).toContain('paragraph');
  expect(kinds).toContain('code-block');
  expect(kinds).toContain('table');
  expect(kinds).toContain('thematic-break');
});

test('keeps unterminated fences open while streaming without warning', () => {
  const source = '```ts\nconst x = 1;';
  const lines = splitLines(source);
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const root = rootResult.value;
  const code = root.children.find((node) => node.type === 'code-block');

  expect(code).toBeDefined();
  expect(code?.closed).toBe(false);
  expect(rootResult.warnings).toEqual([]);
});

test('treats citation definition lines as metadata and not content blocks', () => {
  const source = '[^a]: Alpha\n\nParagraph';
  const lines = splitLines(source);
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const root = rootResult.value;

  expect(root.children).toHaveLength(1);
  expect(root.children[0].type).toBe('paragraph');
});

test('supports empty block ranges', () => {
  const lines = splitLines('');
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, 0, '0', context, true);

  expect(rootResult.value.children).toEqual([]);
  expect(rootResult.value.range).toEqual({ start: 0, end: 0 });
});

test('hides unfinished citation-definition prefixes while streaming', () => {
  const source = 'Paragraph\n[^source';
  const lines = splitLines(source);
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const root = rootResult.value;
  const paragraphs = root.children.filter((node) => node.type === 'paragraph');

  expect(paragraphs).toHaveLength(1);
  expect(root.children.some((node) => node.type === 'citation')).toBe(false);
});

test('parses setext level-1 heading with equals underline', () => {
  const lines = splitLines('Title\n===\n');
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const heading = rootResult.value.children.find(
    (node) => node.type === 'heading',
  );

  expect(heading).toBeDefined();
  expect(heading?.props['level']).toBe(1);
});

test('accepts list continuation indented to content column', () => {
  const lines = splitLines('1. one\n   two\n');
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const list = rootResult.value.children.find((node) => node.type === 'list');
  const paragraph =
    list?.children[0]?.children[0] &&
    list.children[0].children[0].type === 'paragraph'
      ? list.children[0].children[0]
      : undefined;

  expect(list).toBeDefined();
  expect(paragraph).toBeDefined();
  expect(paragraph?.children.length).toBeGreaterThan(1);
});

test('parses fence info + meta for backtick and tilde fences', () => {
  const lines = splitLines('```ts meta\nx\n```\n~~~js data\ny\n~~~\n');
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const codeBlocks = rootResult.value.children.filter(
    (node) => node.type === 'code-block',
  );

  expect(codeBlocks).toHaveLength(2);
  expect(codeBlocks[0].props['info']).toBe('ts');
  expect(codeBlocks[0].props['meta']).toBe('meta');
  expect(codeBlocks[1].props['info']).toBe('js');
  expect(codeBlocks[1].props['meta']).toBe('data');
});

test('parses blockquote content as nested blocks', () => {
  const lines = splitLines(
    '> # Heading\n> - item\n>\n> ```ts\n> const x = 1;\n> ```\n',
  );
  const context = createContext();

  const rootResult = parseBlocks(lines, 0, lines.length, '0', context, true);
  const quote = rootResult.value.children.find(
    (node) => node.type === 'blockquote',
  );

  expect(quote).toBeDefined();
  expect(quote?.children.map((node) => node.type)).toEqual([
    'heading',
    'list',
    'code-block',
  ]);
});
