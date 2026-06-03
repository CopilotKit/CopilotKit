import { assignCitationNumber, parseCitationDefinitions } from './citations';
import type { CitationState } from './types';

test('parses citation definitions and extracts trailing urls', () => {
  const result = parseCitationDefinitions(
    '[^a]: Alpha https://a.test\n[^b]: Beta',
  );

  expect(result.citations.definitions['a']).toEqual({
    id: 'a',
    text: 'Alpha',
    url: 'https://a.test',
  });
  expect(result.citations.definitions['b']).toEqual({
    id: 'b',
    text: 'Beta',
  });
  expect(result.warnings).toEqual([]);
});

test('warns on duplicate citation definitions and keeps first', () => {
  const result = parseCitationDefinitions('[^a]: One\n[^a]: Two');

  expect(result.citations.definitions['a']).toEqual({ id: 'a', text: 'One' });
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0].code).toBe('invalid_citation_definition');
});

test('assigns citation numbers by first reference order', () => {
  const citations: CitationState = {
    order: [],
    numbers: {},
    definitions: {},
  };

  const first = assignCitationNumber(citations, 'b');
  const second = assignCitationNumber(first.citations, 'a');
  const again = assignCitationNumber(second.citations, 'b');

  expect(first.number).toBe(1);
  expect(second.number).toBe(2);
  expect(again.number).toBe(1);
  expect(again.citations.order).toEqual(['b', 'a']);
  expect(again.citations.numbers).toEqual({ b: 1, a: 2 });
});
