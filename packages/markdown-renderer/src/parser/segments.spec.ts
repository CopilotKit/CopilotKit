import { createSegments } from './segments';

test('returns empty segments when segmentation is disabled', () => {
  const result = createSegments('hello', 0, {
    segmenter: false,
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments).toEqual([]);
  expect(result.warning).toBeUndefined();
  expect(result.hasWarnedSegmenterUnavailable).toBe(false);
});

test('creates word segments by default', () => {
  const result = createSegments('ab', 10, {
    segmenter: true,
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toEqual({
    text: 'ab',
    start: 10,
    end: 12,
    kind: 'word',
    isWhitespace: false,
  });
});

test('supports explicit locale and granularity options', () => {
  const result = createSegments('one two', 0, {
    segmenter: { locale: 'en', granularity: 'word' },
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments.some((segment) => segment.kind === 'word')).toBe(true);
});

test('attaches trailing ASCII punctuation to the previous word segment', () => {
  const result = createSegments('Hello world, how are you?', 0, {
    segmenter: { locale: 'en', granularity: 'word' },
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments.map((segment) => segment.text)).toEqual([
    'Hello',
    ' ',
    'world,',
    ' ',
    'how',
    ' ',
    'are',
    ' ',
    'you?',
  ]);
});

test('attaches opening punctuation to the following segment', () => {
  const result = createSegments('(hello)', 0, {
    segmenter: { locale: 'en', granularity: 'word' },
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments.map((segment) => segment.text)).toEqual(['(hello)']);
});

test('attaches trailing CJK punctuation to the previous word segment', () => {
  const result = createSegments('你好，世界。', 0, {
    segmenter: { locale: 'zh', granularity: 'word' },
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments.map((segment) => segment.text)).toEqual([
    '你好，',
    '世界。',
  ]);
});

test('defaults object segmenter options to word granularity', () => {
  const result = createSegments('ab', 0, {
    segmenter: {},
    hasWarnedSegmenterUnavailable: false,
  });

  expect(result.segments[0]?.kind).toBe('word');
});

test('adds one warning when Intl.Segmenter is unavailable', () => {
  const intlWithSegmenter = Intl as unknown as {
    Segmenter?: typeof Intl.Segmenter;
  };
  const original = intlWithSegmenter.Segmenter;
  intlWithSegmenter.Segmenter = undefined;

  try {
    const first = createSegments('hello', 0, {
      segmenter: true,
      hasWarnedSegmenterUnavailable: false,
    });
    const second = createSegments('world', 5, {
      segmenter: true,
      hasWarnedSegmenterUnavailable: first.hasWarnedSegmenterUnavailable,
    });

    expect(first.segments).toEqual([]);
    expect(second.segments).toEqual([]);
    expect(first.warning).toEqual({
      code: 'segmenter_unavailable',
      at: 0,
    });
    expect(second.warning).toBeUndefined();
  } finally {
    intlWithSegmenter.Segmenter = original;
  }
});

test('returns warning when Intl is unavailable', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'Intl',
  );

  Object.defineProperty(globalThis, 'Intl', {
    value: undefined,
    configurable: true,
    writable: true,
  });

  try {
    const result = createSegments('hello', 0, {
      segmenter: true,
      hasWarnedSegmenterUnavailable: false,
    });

    expect(result.segments).toEqual([]);
    expect(result.warning).toEqual({ code: 'segmenter_unavailable', at: 0 });
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'Intl', originalDescriptor);
    }
  }
});
