// Derived from hashbrown/packages/core/src/skillet/parser/json-parser.spec.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import {
  createParserState,
  finalizeJsonParse,
  getResolvedValue,
  type JsonAstNode,
  parseChunk,
} from '../json-parser';

function getNode(nodes: JsonAstNode[], id: number | null) {
  if (id === null) {
    throw new Error('Missing node id');
  }

  const node = nodes[id];
  if (!node) {
    throw new Error(`Missing node ${id}`);
  }

  return node;
}

test('parses a complete object in one chunk', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a":1,"b":"x"}');
  const done = finalizeJsonParse(next);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual({ a: 1, b: 'x' });

  const root = getNode(done.nodes, done.rootId);
  expect(root.type).toBe('object');
  expect(root.closed).toBe(true);
  expect(root.resolvedValue).toEqual({ a: 1, b: 'x' });
});

test('parses empty array and object roots', () => {
  const arrayState = finalizeJsonParse(parseChunk(createParserState(), '[]'));
  const objectState = finalizeJsonParse(parseChunk(createParserState(), '{}'));

  expect(arrayState.error).toBeNull();
  expect(arrayState.isComplete).toBe(true);
  expect(getResolvedValue(arrayState)).toEqual([]);

  expect(objectState.error).toBeNull();
  expect(objectState.isComplete).toBe(true);
  expect(getResolvedValue(objectState)).toEqual({});
});

test('parses with leading and interstitial whitespace across chunks', () => {
  const state = createParserState();

  const next = parseChunk(state, ' \n\t');
  const next2 = parseChunk(next, '{"a"');
  const next3 = parseChunk(next2, ':\n 1');
  const next4 = parseChunk(next3, ' }');
  const done = finalizeJsonParse(next4);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual({ a: 1 });
});

test('parses across chunk boundaries with unicode escapes and arrays', () => {
  const state = createParserState();

  const chunk1 = '{"text":"hello \\u2';
  const chunk2 = '63A","arr":[true,false,null]}';
  const next = parseChunk(state, chunk1);
  const next2 = parseChunk(next, chunk2);
  const done = finalizeJsonParse(next2);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual({
    text: 'hello \u263A',
    arr: [true, false, null],
  });
});

test('parses a string with an escape split across chunks', () => {
  const state = createParserState();

  const next = parseChunk(state, '"he\\');
  const next2 = parseChunk(next, 'nlo"');
  const done = finalizeJsonParse(next2);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toBe('he\nlo');
});

test('parses literals split across chunks', () => {
  const state = createParserState();

  const next = parseChunk(state, '[t');
  const next2 = parseChunk(next, 'rue,fa');
  const next3 = parseChunk(next2, 'lse,nu');
  const next4 = parseChunk(next3, 'll]');
  const done = finalizeJsonParse(next4);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual([true, false, null]);
});

test('parses object keys with escapes split across chunks', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a\\u2');
  const next2 = parseChunk(next, '63A":1}');
  const done = finalizeJsonParse(next2);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual({ 'a\u263A': 1 });
});

test('parses a number split across chunks', () => {
  const state = createParserState();

  const next = parseChunk(state, '12.3e');
  const next2 = parseChunk(next, '+2');
  const done = finalizeJsonParse(next2);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toBe(1230);
});

test('parses deep nesting across chunk boundaries', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a":[');
  const next2 = parseChunk(next, '{"b":[1');
  const next3 = parseChunk(next2, ']}]}');
  const done = finalizeJsonParse(next3);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual({ a: [{ b: [1] }] });
});

test('updates open container resolved values incrementally', () => {
  const state = createParserState();

  const next = parseChunk(state, '[1,');
  const root = getNode(next.nodes, next.rootId);

  expect(next.error).toBeNull();
  expect(next.isComplete).toBe(false);
  expect(root.type).toBe('array');
  expect(root.closed).toBe(false);
  expect(root.resolvedValue).toEqual([1]);

  const next2 = parseChunk(next, '2]');
  const done = finalizeJsonParse(next2);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual([1, 2]);
});

test('updates open string resolved values incrementally', () => {
  const state = createParserState();

  const next = parseChunk(state, '"he');
  const root = getNode(next.nodes, next.rootId);

  expect(next.error).toBeNull();
  expect(next.isComplete).toBe(false);
  expect(root.type).toBe('string');
  expect(root.closed).toBe(false);
  expect(root.resolvedValue).toBe('he');

  const next2 = parseChunk(next, 'llo"');
  const done = finalizeJsonParse(next2);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toBe('hello');
});

test('preserves identity for unchanged subtrees', () => {
  const state = createParserState();

  const next = parseChunk(state, '[{"a":1},');
  const root = getNode(next.nodes, next.rootId);
  const firstChildId = root.type === 'array' ? root.children[0] : null;
  const firstChild = getNode(next.nodes, firstChildId);

  const next2 = parseChunk(next, '{"b":2}]');
  const done = finalizeJsonParse(next2);
  const rootAfter = getNode(done.nodes, done.rootId);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual([{ a: 1 }, { b: 2 }]);
  expect(rootAfter).not.toBe(root);
  expect(getNode(done.nodes, firstChildId)).toBe(firstChild);
});

test('preserves resolved value identity for unchanged nested containers', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a":[1],');
  const root = getNode(next.nodes, next.rootId);
  const arrayId = root.type === 'object' ? root.children[0] : null;
  const arrayNode = getNode(next.nodes, arrayId);
  const arrayValue = arrayNode.resolvedValue;

  const next2 = parseChunk(next, '"b":2}');
  const done = finalizeJsonParse(next2);
  const rootAfter = getNode(done.nodes, done.rootId);
  const arrayAfter = getNode(done.nodes, arrayId);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual({ a: [1], b: 2 });
  expect(rootAfter).not.toBe(root);
  expect(arrayAfter).toBe(arrayNode);
  expect(arrayAfter.resolvedValue).toBe(arrayValue);
});

test('preserves sibling identity when appending to nested arrays', () => {
  const state = createParserState();

  const next = parseChunk(state, '[[1],');
  const root = getNode(next.nodes, next.rootId);
  const firstChildId = root.type === 'array' ? root.children[0] : null;
  const firstChild = getNode(next.nodes, firstChildId);
  const firstChildValue = firstChild.resolvedValue;

  const next2 = parseChunk(next, '[2]]');
  const done = finalizeJsonParse(next2);
  const rootAfter = getNode(done.nodes, done.rootId);

  expect(done.error).toBeNull();
  expect(done.isComplete).toBe(true);
  expect(getResolvedValue(done)).toEqual([[1], [2]]);
  expect(rootAfter).not.toBe(root);
  expect(getNode(done.nodes, firstChildId)).toBe(firstChild);
  expect(getNode(done.nodes, firstChildId).resolvedValue).toBe(firstChildValue);
});

test('returns errors instead of throwing for malformed JSON', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a":1');
  const done = finalizeJsonParse(next);

  expect(done.error).not.toBeNull();
  expect(done.isComplete).toBe(false);
  expect(getResolvedValue(done)).toBeUndefined();
});

test('rejects trailing non-whitespace after a valid root', () => {
  const state = createParserState();

  const next = parseChunk(state, '1');
  const next2 = parseChunk(next, ' x');

  expect(next2.error).not.toBeNull();
  expect(next2.isComplete).toBe(false);
  expect(getResolvedValue(next2)).toBeUndefined();
});

test('rejects invalid escape sequences in strings', () => {
  const state = createParserState();

  const next = parseChunk(state, '"bad\\q"');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Invalid escape sequence');
  expect(next.isComplete).toBe(false);
});

test('rejects invalid unicode escapes in strings', () => {
  const state = createParserState();

  const next = parseChunk(state, '"bad \\u12X4"');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Invalid unicode escape');
  expect(next.isComplete).toBe(false);
});

test('rejects control characters in strings', () => {
  const state = createParserState();

  const next = parseChunk(state, '"line\nbreak"');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Invalid string character');
  expect(next.isComplete).toBe(false);
});

test('rejects invalid numbers', () => {
  const state = createParserState();

  const next = parseChunk(state, '01');
  const done = finalizeJsonParse(next);

  expect(done.error).not.toBeNull();
  expect(done.error?.message).toBe('Invalid number');
  expect(done.isComplete).toBe(false);
});

test('rejects missing colons in objects', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a" 1}');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Expected colon');
  expect(next.isComplete).toBe(false);
});

test('rejects missing commas in arrays', () => {
  const state = createParserState();

  const next = parseChunk(state, '[1 2]');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Expected comma or closing bracket');
  expect(next.isComplete).toBe(false);
});

test('rejects missing commas in objects', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a":1 "b":2}');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Expected comma or closing brace');
  expect(next.isComplete).toBe(false);
});

test('rejects unexpected end-of-input in containers', () => {
  const state = createParserState();

  const next = parseChunk(state, '{"a":1');
  const done = finalizeJsonParse(next);

  expect(done.error).not.toBeNull();
  expect(done.error?.message).toBe('Unexpected end of JSON input');
  expect(done.isComplete).toBe(false);
});

test('rejects trailing commas in arrays and objects', () => {
  const arrayState = createParserState();
  const arrayNext = parseChunk(arrayState, '[1,]');

  expect(arrayNext.error).not.toBeNull();
  expect(arrayNext.isComplete).toBe(false);

  const objectState = createParserState();
  const objectNext = parseChunk(objectState, '{"a":1,}');

  expect(objectNext.error).not.toBeNull();
  expect(objectNext.isComplete).toBe(false);
});

test('rejects unexpected tokens after a closed container', () => {
  const state = createParserState();

  const next = parseChunk(state, '[1]2');

  expect(next.error).not.toBeNull();
  expect(next.error?.message).toBe('Unexpected trailing token');
  expect(next.isComplete).toBe(false);
});
