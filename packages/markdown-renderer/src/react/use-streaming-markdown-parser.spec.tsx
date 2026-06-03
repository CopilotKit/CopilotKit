import { renderHook } from '@testing-library/react';
import { useStreamingMarkdownParser } from './use-streaming-markdown-parser';

test('useStreamingMarkdownParser parses prefix updates incrementally', () => {
  const { result, rerender } = renderHook(
    ({ text }) =>
      useStreamingMarkdownParser(text, {
        segmenter: false,
      }),
    {
      initialProps: {
        text: 'first\n\nsecond',
      },
    },
  );

  const firstParagraphBefore = result.current.nodes.find(
    (node) => node.type === 'paragraph' && node.range.start === 0,
  );

  rerender({
    text: 'first\n\nsecond line',
  });

  const firstParagraphAfter = result.current.nodes.find(
    (node) => node.type === 'paragraph' && node.range.start === 0,
  );

  expect(firstParagraphBefore).toBeDefined();
  expect(firstParagraphAfter).toBe(firstParagraphBefore);
});

test('useStreamingMarkdownParser resets when text is not a prefix update', () => {
  const { result, rerender } = renderHook(
    ({ text }) =>
      useStreamingMarkdownParser(text, {
        segmenter: false,
      }),
    {
      initialProps: {
        text: 'hello',
      },
    },
  );

  expect(result.current.source).toBe('hello');

  rerender({
    text: 'yo',
  });

  expect(result.current.source).toBe('yo');
});

test('useStreamingMarkdownParser finalizes when complete flag is enabled', () => {
  const { result, rerender } = renderHook(
    ({ isComplete }) =>
      useStreamingMarkdownParser('```ts\nconst a = 1;', { segmenter: false }, isComplete),
    {
      initialProps: {
        isComplete: false,
      },
    },
  );

  const openFenceBefore = result.current.nodes.find(
    (node) => node.type === 'code-block',
  );

  rerender({ isComplete: true });

  const openFenceAfter = result.current.nodes.find(
    (node) => node.type === 'code-block',
  );

  expect(openFenceBefore?.closed).toBe(false);
  expect(openFenceAfter?.closed).toBe(true);
  expect(result.current.isComplete).toBe(true);
});

test('useStreamingMarkdownParser preserves unchanged node identity when complete flag toggles', () => {
  const { result, rerender } = renderHook(
    ({ isComplete }) =>
      useStreamingMarkdownParser('first\n\nsecond', { segmenter: false }, isComplete),
    {
      initialProps: {
        isComplete: false,
      },
    },
  );

  const firstParagraphBefore = result.current.nodes.find(
    (node) => node.type === 'paragraph' && node.range.start === 0,
  );

  rerender({ isComplete: true });

  const firstParagraphAfter = result.current.nodes.find(
    (node) => node.type === 'paragraph' && node.range.start === 0,
  );

  expect(firstParagraphBefore).toBeDefined();
  expect(firstParagraphAfter).toBe(firstParagraphBefore);
});
