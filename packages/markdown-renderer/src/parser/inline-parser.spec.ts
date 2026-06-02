// Derived from hashbrown "Magic Text" (MIT, © LiveLoveApp, LLC). See NOTICE.
import { parseInline } from './inline-parser';
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

test('parses mixed inline nodes in source order', () => {
  const context = createContext();

  const result = parseInline(
    'a [link](https://x.test) ![img](https://x.test/i.png) `c` *e* **s** ~~d~~ [^r] <https://a.test>',
    0,
    '0.0',
    context,
  );

  const nodes = result.value;
  const kinds = nodes.map((node) => node.type);

  expect(kinds).toContain('link');
  expect(kinds).toContain('image');
  expect(kinds).toContain('inline-code');
  expect(kinds).toContain('em');
  expect(kinds).toContain('strong');
  expect(kinds).toContain('strikethrough');
  expect(kinds).toContain('citation');
  expect(kinds).toContain('autolink');
});

test('emits hard and soft breaks based on markdown rules', () => {
  const context = createContext();

  const result = parseInline('a\nb  \nc\\\nd', 0, '0.0', context);
  const nodes = result.value;

  const breaks = nodes.filter(
    (node) => node.type === 'soft-break' || node.type === 'hard-break',
  );

  expect(breaks.map((node) => node.type)).toEqual([
    'soft-break',
    'hard-break',
    'hard-break',
  ]);
});

test('consumes an unescaped backslash marker before a hard break', () => {
  const context = createContext();

  const result = parseInline('line\\\nnext', 0, '0.0', context);
  const nodes = result.value;
  const text = nodes
    .filter((node) => node.type === 'text')
    .map((node) => (node.type === 'text' ? node.props['text'] : ''))
    .join('');
  const breaks = nodes.filter(
    (node) => node.type === 'soft-break' || node.type === 'hard-break',
  );

  expect(text).toBe('linenext');
  expect(breaks.map((node) => node.type)).toEqual(['hard-break']);
});

test('does not treat escaped backslash before newline as a hard break marker', () => {
  const context = createContext();

  const result = parseInline('line\\\\\nnext', 0, '0.0', context);
  const breaks = result.value.filter(
    (node) => node.type === 'soft-break' || node.type === 'hard-break',
  );
  const text = result.value
    .filter((node) => node.type === 'text')
    .map((node) => (node.type === 'text' ? node.props['text'] : ''))
    .join('');

  expect(breaks.map((node) => node.type)).toEqual(['soft-break']);
  expect(text).toBe('line\\next');
});

test('supports escaped punctuation and does not keep the backslash', () => {
  const context = createContext();

  const result = parseInline('\\*', 0, '0.0', context);
  const nodes = result.value;

  expect(nodes).toHaveLength(1);
  expect(nodes[0].type).toBe('text');
  expect(nodes[0].type === 'text' ? nodes[0].props['text'] : '').toBe('*');
});

test('assigns citation numbers from inline references', () => {
  const context = createContext();

  const result = parseInline('[^b] and [^a] and [^b]', 0, '0.0', context);
  const nodes = result.value;
  const citations = nodes.filter((node) => node.type === 'citation');

  expect(citations).toHaveLength(3);
  expect(result.citations.order).toEqual(['b', 'a']);
  expect(result.citations.numbers).toEqual({ b: 1, a: 2 });
});

test('optimistically parses unfinished inline citation references while incomplete', () => {
  const context = createContext();

  const result = parseInline('Tail [^eater', 0, '0.0', context);
  const citation = result.value.find((node) => node.type === 'citation');
  const text = result.value
    .filter((node) => node.type === 'text')
    .map((node) => (node.type === 'text' ? node.props['text'] : ''))
    .join('');

  expect(citation?.type).toBe('citation');
  expect(citation?.closed).toBe(false);
  expect(citation?.type === 'citation' ? citation.props['idRef'] : '').toBe(
    'eater',
  );
  expect(text).toContain('Tail ');
  expect(text).not.toContain('[^eater');
});

test('does not optimistically parse unfinished inline citation references when complete', () => {
  const context = createContext();
  context.isComplete = true;

  const result = parseInline('Tail [^eater', 0, '0.0', context);
  const text = result.value
    .filter((node) => node.type === 'text')
    .map((node) => (node.type === 'text' ? node.props['text'] : ''))
    .join('');

  expect(result.value.some((node) => node.type === 'citation')).toBe(false);
  expect(text).toContain('[^eater');
});

test('keeps unterminated inline constructs as optimistic open nodes', () => {
  const context = createContext();

  const result = parseInline('**oops [link](https://x.test', 0, '0.0', context);
  const nodes = result.value;
  const strong = nodes.find((node) => node.type === 'strong');

  expect(strong?.closed).toBe(false);
  expect(result.warnings).toEqual([]);
});

test('treats malformed citation, link, and image markers as plain text', () => {
  const context = createContext();

  const result = parseInline(
    '[^ ] [x](missing ![alt](missing',
    0,
    '0.0',
    context,
  );
  const text = result.value
    .filter((node) => node.type === 'text')
    .map((node) => (node.type === 'text' ? node.props['text'] : ''))
    .join('');

  expect(result.value.some((node) => node.type === 'citation')).toBe(false);
  expect(result.value.some((node) => node.type === 'link')).toBe(false);
  expect(result.value.some((node) => node.type === 'image')).toBe(false);
  expect(text.includes('[^ ]')).toBe(true);
});

test('does not parse bare autolinks when boundary rules are not satisfied', () => {
  const context = createContext();

  const result = parseInline('xhttps://a.test', 0, '0.0', context);

  expect(result.value.some((node) => node.type === 'autolink')).toBe(false);
});

test('does not parse invalid angle-bracket autolink', () => {
  const context = createContext();

  const result = parseInline('<not-a-url>', 0, '0.0', context);
  const text = result.value
    .filter((node) => node.type === 'text')
    .map((node) => (node.type === 'text' ? node.props['text'] : ''))
    .join('');

  expect(result.value.some((node) => node.type === 'autolink')).toBe(false);
  expect(text).toContain('<not-a-url>');
});

test('parses immediate-close delimiters without getting stuck', () => {
  const context = createContext();

  const result = parseInline('**** ~~ ~~ __ __', 0, '0.0', context);

  expect(result.value.length).toBeGreaterThan(0);
  expect(result.value.some((node) => node.type === 'strong')).toBe(true);
});
