import {
  findClosing,
  getLineBuffer,
  isBlank,
  isCitationDefinitionLine,
  isCitationDefinitionPrefixCandidate,
  isEmail,
  isEscapable,
  isPipeTableHeader,
  isSetextUnderline,
  isThematicBreak,
  isUrl,
  matchAtxHeading,
  matchFenceClose,
  matchFenceOpen,
  matchListItem,
  normalizeChunk,
  normalizeOptions,
  parseLinkDestination,
  parseTableAlignment,
  splitLines,
  splitTableCells,
  startsNewBlock,
  toLineColumn,
  trimAutolinkTrailingPunctuation,
} from './helpers';

test('normalizes options with defaults', () => {
  const result = normalizeOptions({ enableTables: false });

  expect(result).toEqual({
    segmenter: true,
    enableTables: false,
    enableAutolinks: true,
  });
});

test('normalizes chunks and carries pending carriage returns', () => {
  const a = normalizeChunk('a\r', false);
  const b = normalizeChunk('\nb\r\nc', a.pendingCarriageReturn);

  expect(a).toEqual({ text: 'a', pendingCarriageReturn: true });
  expect(b).toEqual({ text: '\nb\nc', pendingCarriageReturn: false });
});

test('splits lines with offsets and computes line buffer', () => {
  const lines = splitLines('a\nb\nlast');

  expect(lines).toHaveLength(3);
  expect(lines[0]).toEqual({ text: 'a', start: 0, end: 2, hasNewline: true });
  expect(getLineBuffer('a\nb\nlast')).toBe('last');
});

test('maps absolute index to line and column', () => {
  const pos = toLineColumn('ab\ncd\n', 5);

  expect(pos).toEqual({ line: 2, column: 3 });
});

test('matches heading, fence, list, and thematic break syntax', () => {
  const heading = matchAtxHeading('### Title ##');
  const fence = matchFenceOpen('```ts');
  const tildeFence = matchFenceOpen('~~~js');
  const list = matchListItem('12. item');

  expect(heading).toEqual({ level: 3, text: 'Title', contentOffset: 4 });
  expect(fence).toEqual({ marker: '```', length: 3, info: 'ts' });
  expect(tildeFence).toEqual({ marker: '~~~', length: 3, info: 'js' });
  expect(matchFenceClose('```', '```', 3)).toBe(true);
  expect(matchFenceClose('~~~', '~~~', 3)).toBe(true);
  expect(list).toEqual({
    ordered: true,
    start: 12,
    content: 'item',
    indent: 0,
    contentIndent: 4,
  });
  expect(isSetextUnderline('---')).toBe(true);
  expect(isThematicBreak('* * *')).toBe(true);
});

test('detects table structures and alignments', () => {
  const first = { text: '| A | B |', start: 0, end: 8, hasNewline: true };
  const second = {
    text: '| :--- | ---: |',
    start: 8,
    end: 22,
    hasNewline: true,
  };

  const cells = splitTableCells('| :--- | ---: |');

  expect(isPipeTableHeader(first, second)).toBe(true);
  expect(cells).toEqual([':---', '---:']);
  expect(parseTableAlignment(cells)).toEqual(['left', 'right']);
  expect(splitTableCells('A | B')).toEqual(['A', 'B']);
});

test('identifies whether line starts a new block', () => {
  const lines = splitLines('first\n# heading\n| A | B |\n| --- | --- |\n');

  const startsHeading = startsNewBlock(lines, 1, true);
  const startsTable = startsNewBlock(lines, 2, true);

  expect(startsHeading).toBe(true);
  expect(startsTable).toBe(true);
});

test('parses link destination and title formats', () => {
  const quoted = parseLinkDestination('https://a.test "t"');
  const single = parseLinkDestination("https://a.test 't'");
  const paren = parseLinkDestination('https://a.test (t)');
  const angled = parseLinkDestination('<https://a.test>');

  expect(quoted).toEqual({ url: 'https://a.test', title: 't' });
  expect(single).toEqual({ url: 'https://a.test', title: 't' });
  expect(paren).toEqual({ url: 'https://a.test', title: 't' });
  expect(angled).toEqual({ url: 'https://a.test' });
});

test('parses nested closers and utility classifiers', () => {
  const close = findClosing('[a[b]c]', 0, '[', ']');
  const escapedClose = findClosing('[a\\]b]', 0, '[', ']');

  expect(close).toBe(6);
  expect(escapedClose).toBe(5);
  expect(isBlank('   ')).toBe(true);
  expect(isCitationDefinitionLine('[^id]: body')).toBe(true);
  expect(isEscapable('*')).toBe(true);
  expect(isUrl('https://a.test')).toBe(true);
  expect(isEmail('a@b.test')).toBe(true);
  expect(trimAutolinkTrailingPunctuation('https://a.test.,')).toBe(
    'https://a.test',
  );
  expect(trimAutolinkTrailingPunctuation('https://a.test)')).toBe(
    'https://a.test',
  );
});

test('identifies optimistic citation-definition prefix candidates', () => {
  expect(isCitationDefinitionPrefixCandidate('[^id', false, false)).toBe(true);
  expect(isCitationDefinitionPrefixCandidate('[^id]', false, false)).toBe(true);
  expect(isCitationDefinitionPrefixCandidate('[^id]: body', false, false)).toBe(
    false,
  );
  expect(isCitationDefinitionPrefixCandidate('[^id] body', false, false)).toBe(
    false,
  );
  expect(isCitationDefinitionPrefixCandidate('[^id', true, false)).toBe(false);
  expect(isCitationDefinitionPrefixCandidate('[^id', false, true)).toBe(false);
});
