import type { SegmenterOptions, TextSegment } from './types';

/**
 * Computes parse-time text segments for animation and incremental rendering.
 *
 * @param text - Raw text content for a single text node.
 * @param absoluteStart - Absolute source index where `text` begins.
 * @param context - Parse context containing segmenter options and warning state.
 * @returns Segment list or empty list when segmentation is disabled/unavailable.
 */
export function createSegments(
  text: string,
  absoluteStart: number,
  options: {
    segmenter: SegmenterOptions;
    hasWarnedSegmenterUnavailable: boolean;
  },
): {
  segments: TextSegment[];
  warning?: { code: 'segmenter_unavailable'; at: number };
  hasWarnedSegmenterUnavailable: boolean;
} {
  if (options.segmenter === false) {
    return {
      segments: [],
      hasWarnedSegmenterUnavailable: options.hasWarnedSegmenterUnavailable,
    };
  }

  const segmenterCtor =
    typeof Intl === 'undefined'
      ? undefined
      : (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;

  if (!segmenterCtor) {
    if (!options.hasWarnedSegmenterUnavailable) {
      return {
        segments: [],
        warning: { code: 'segmenter_unavailable', at: absoluteStart },
        hasWarnedSegmenterUnavailable: true,
      };
    }

    return {
      segments: [],
      hasWarnedSegmenterUnavailable: true,
    };
  }

  const granularity =
    options.segmenter === true
      ? 'word'
      : (options.segmenter.granularity ?? 'word');
  const locale =
    options.segmenter === true ? undefined : options.segmenter.locale;

  const segmenter = new segmenterCtor(locale, { granularity });
  const segments: TextSegment[] = [];

  for (const segment of segmenter.segment(text)) {
    const segmentText = segment.segment;
    const start = absoluteStart + segment.index;

    segments.push({
      text: segmentText,
      start,
      end: start + segmentText.length,
      kind: granularity,
      isWhitespace: /^\s+$/.test(segmentText),
    });
  }

  const clustered = clusterPunctuationSegments(segments);

  return {
    segments: clustered,
    hasWarnedSegmenterUnavailable: options.hasWarnedSegmenterUnavailable,
  };
}

function clusterPunctuationSegments(segments: TextSegment[]): TextSegment[] {
  const withClosingAttached = segments.reduce<TextSegment[]>((acc, segment) => {
    const previous = acc[acc.length - 1];
    if (
      previous &&
      !previous.isWhitespace &&
      isClosingPunctuationOnly(segment.text)
    ) {
      acc[acc.length - 1] = {
        ...previous,
        text: `${previous.text}${segment.text}`,
        end: segment.end,
      };

      return acc;
    }

    return [...acc, segment];
  }, []);

  const clustered: TextSegment[] = [];
  let i = 0;
  while (i < withClosingAttached.length) {
    const current = withClosingAttached[i];
    const next =
      i + 1 < withClosingAttached.length ? withClosingAttached[i + 1] : null;

    if (next && !next.isWhitespace && isOpeningPunctuationOnly(current.text)) {
      clustered.push({
        ...next,
        text: `${current.text}${next.text}`,
        start: current.start,
      });
      i += 2;
      continue;
    }

    clustered.push(current);
    i += 1;
  }

  return clustered;
}

function isClosingPunctuationOnly(value: string): boolean {
  return isOnlyFromSet(value, CLOSING_PUNCTUATION);
}

function isOpeningPunctuationOnly(value: string): boolean {
  return isOnlyFromSet(value, OPENING_PUNCTUATION);
}

function isOnlyFromSet(value: string, charset: ReadonlySet<string>): boolean {
  return (
    value.length > 0 && [...value].every((character) => charset.has(character))
  );
}

const CLOSING_PUNCTUATION = new Set([
  ']',
  ',',
  '.',
  '!',
  '?',
  ';',
  ':',
  '%',
  ')',
  '}',
  '>',
  '"',
  "'",
  '、',
  '。',
  '，',
  '．',
  '！',
  '？',
  '：',
  '；',
  '％',
  '）',
  '］',
  '｝',
  '〉',
  '》',
  '」',
  '』',
  '】',
  '〕',
  '〗',
]);

const OPENING_PUNCTUATION = new Set([
  '(',
  '{',
  '[',
  '"',
  "'",
  '〈',
  '《',
  '「',
  '『',
  '【',
  '〔',
  '〖',
  '（',
  '［',
  '｛',
]);
