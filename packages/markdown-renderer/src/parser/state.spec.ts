// Derived from hashbrown "Magic Text" (MIT, © LiveLoveApp, LLC). See NOTICE.
import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from './state';

test('tracks source index, line, and column across chunks', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = parseStreamingMarkdownChunk(state, 'ab\ncd');

  expect(a.index).toBe(5);
  expect(a.line).toBe(2);
  expect(a.column).toBe(3);
});

test('maintains trailing line buffer until newline arrives', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = parseStreamingMarkdownChunk(state, 'abc');
  const b = parseStreamingMarkdownChunk(a, '\n');

  expect(a.lineBuffer).toBe('abc');
  expect(b.lineBuffer).toBe('');
});

test('flushes pending carriage return during finalize', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = parseStreamingMarkdownChunk(state, 'a\r');
  const b = finalizeStreamingMarkdown(a);

  expect(a.pendingCarriageReturn).toBe(true);
  expect(b.pendingCarriageReturn).toBe(false);
  expect(b.source.endsWith('\n')).toBe(true);
});

test('is idempotent when finalizing an already complete state', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const a = finalizeStreamingMarkdown(parseStreamingMarkdownChunk(state, 'x'));
  const b = finalizeStreamingMarkdown(a);

  expect(b).toBe(a);
});

test('tracks heading mode while heading remains open', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, '# heading');

  expect(next.mode).toBe('heading');
});

test('tracks blockquote mode while blockquote remains open', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, '> quote');

  expect(next.mode).toBe('blockquote');
});

test('falls back to block mode when root is missing', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });
  const invalid = { ...state, rootId: null as number | null };

  const next = parseStreamingMarkdownChunk(invalid, 'text');

  expect(next.mode).toBe('paragraph');
});

test('tracks code-fence mode while fence is open', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, '```ts\nconst x = 1;');

  expect(next.mode).toBe('code-fence');
});

test('tracks table mode while table is open', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(
    state,
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
  );

  expect(next.mode).toBe('table');
});

test('does not infer completion when trailing carriage return is pending', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, 'done\r');

  expect(next.pendingCarriageReturn).toBe(true);
  expect(next.isComplete).toBe(false);
});

test('does not infer completion when a chunk ends at a newline boundary', () => {
  const state = createStreamingMarkdownParserState({ segmenter: false });

  const next = parseStreamingMarkdownChunk(state, '1. one\n');

  expect(next.lineBuffer).toBe('');
  expect(next.isComplete).toBe(false);
});
