// Derived from hashbrown/packages/react/src/hooks/use-imperative-json-parser.spec.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { act, renderHook } from '@testing-library/react';
import { s } from '@copilotkitnext/core/streaming-json';
import { useImperativeJsonParser } from '../use-imperative-json-parser';

test('useImperativeJsonParser preserves identity for unchanged branches', () => {
  const schema = s.streaming.object('obj', {
    a: s.streaming.array('a', s.string('a')),
    b: s.streaming.array('b', s.string('b')),
  });

  const { result } = renderHook(() => useImperativeJsonParser(schema));

  act(() => {
    result.current.parseChunk('{"a":["x"],');
  });

  const firstValue = result.current.value;
  const firstA = firstValue?.a;
  const firstB = firstValue?.b;

  expect(firstValue).toEqual({ a: ['x'], b: [] });

  act(() => {
    result.current.parseChunk('"b":["y"]}');
  });

  const secondValue = result.current.value;

  expect(secondValue).toEqual({ a: ['x'], b: ['y'] });
  expect(secondValue?.a).toBe(firstA);
  expect(secondValue?.b).not.toBe(firstB);
});

test('useImperativeJsonParser streams partial string values', () => {
  const schema = s.streaming.string('text');
  const { result } = renderHook(() => useImperativeJsonParser(schema));

  act(() => {
    result.current.parseChunk('"he');
  });

  expect(result.current.value).toBe('he');
  expect(result.current.error).toBeUndefined();
  expect(result.current.parserState.isComplete).toBe(false);

  act(() => {
    result.current.parseChunk('llo"');
  });

  expect(result.current.value).toBe('hello');
  expect(result.current.parserState.isComplete).toBe(true);
});

test('useImperativeJsonParser preserves streaming array identity when no new match', () => {
  const schema = s.streaming.array('arr', s.string('str'));
  const { result } = renderHook(() => useImperativeJsonParser(schema));

  act(() => {
    result.current.parseChunk('["a","b');
  });

  const firstValue = result.current.value;

  act(() => {
    result.current.parseChunk('c');
  });

  const secondValue = result.current.value;

  expect(firstValue).toEqual(['a']);
  expect(secondValue).toEqual(['a']);
  expect(secondValue).toBe(firstValue);
});

test('useImperativeJsonParser does not reset when schema instances are structurally identical', () => {
  const makeSchema = () =>
    s.streaming.object('obj', {
      text: s.streaming.string('text'),
    });

  const { result, rerender } = renderHook(
    ({ schema }) => useImperativeJsonParser(schema),
    {
      initialProps: { schema: makeSchema() },
    },
  );

  act(() => {
    result.current.parseChunk('{"text":"he');
  });

  rerender({ schema: makeSchema() });

  act(() => {
    result.current.parseChunk('llo"}');
  });

  expect(result.current.error).toBeUndefined();
  expect(result.current.value).toEqual({ text: 'hello' });
});

test('useImperativeJsonParser exposes parser errors without schema', () => {
  const { result } = renderHook(() => useImperativeJsonParser());

  act(() => {
    result.current.parseChunk('{"a":1,]');
  });

  expect(result.current.value).toBeUndefined();
  expect(result.current.error).toBeDefined();
  expect(result.current.parserState.error).not.toBeNull();
});

test('useImperativeJsonParser resolves root value when no schema and JSON completes', () => {
  const { result } = renderHook(() => useImperativeJsonParser());

  act(() => {
    result.current.parseChunk('{"a":1}');
  });

  expect(result.current.value).toEqual({ a: 1 });
  expect(result.current.error).toBeUndefined();
  expect(result.current.parserState.isComplete).toBe(true);
});

test('useImperativeJsonParser returns root resolvedValue even when JSON is incomplete', () => {
  const { result } = renderHook(() => useImperativeJsonParser());

  act(() => {
    result.current.parseChunk('[1,');
  });

  expect(result.current.value).toEqual([1]);
  expect(result.current.parserState.isComplete).toBe(false);
});

test('useImperativeJsonParser returns root partial value when JSON is incomplete', () => {
  const { result } = renderHook(() => useImperativeJsonParser());

  act(() => {
    result.current.parseChunk('"he');
  });

  expect(result.current.value).toBe('he');
  expect(result.current.parserState.isComplete).toBe(false);
});

test('useImperativeJsonParser reset clears resolved value', () => {
  const schema = s.streaming.string('text');
  const { result } = renderHook(() => useImperativeJsonParser(schema));

  act(() => {
    result.current.parseChunk('"he');
  });

  expect(result.current.value).toBe('he');

  act(() => {
    result.current.reset();
  });

  expect(result.current.value).toBeUndefined();
  expect(result.current.error).toBeUndefined();
});
