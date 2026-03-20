// Derived from hashbrown/packages/core/src/schema/schema-parser-interaction.spec.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import * as s from '../index';
import {
  createParserState,
  finalizeJsonParse,
  parseChunk,
  type ParserState,
} from '../../json-parser';
import { SchemaTypeCtor, PRIMITIVE_WRAPPER_FIELD_NAME } from '../base';

function parseChunkResult<T extends s.SchemaType>(schema: T, input: string) {
  const state = parseChunk(createParserState(), input);
  return s.fromJsonAst(schema, state);
}

function parseCompleteResult<T extends s.SchemaType>(
  schema: T,
  input: string,
) {
  const state = finalizeJsonParse(parseChunk(createParserState(), input));
  return s.fromJsonAst(schema, state);
}

function expectMatch<T>(output: s.FromJsonAstOutput<T>) {
  expect(output.result.state).toBe('match');
  if (output.result.state !== 'match') {
    throw new Error('Expected match');
  }
  return output.result.value;
}

function expectNoMatch<T>(output: s.FromJsonAstOutput<T>) {
  expect(output.result.state).toBe('no-match');
}

function expectInvalid<T>(output: s.FromJsonAstOutput<T>) {
  expect(output.result.state).toBe('invalid');
}

function applyChunk<T extends s.SchemaType>(
  schema: T,
  state: ParserState,
  cache: s.FromJsonAstCache | undefined,
  chunk: string,
) {
  const nextState = parseChunk(state, chunk);
  const output = s.fromJsonAst(schema, nextState, cache);
  return {
    state: nextState,
    cache: output.cache,
    result: output.result,
  };
}

test('it should parse very simple schema', () => {
  const schema = s.string('a string');
  const input = `"hello"`;

  const result = parseCompleteResult(schema, input);

  expect(expectMatch(result)).toEqual('hello');
});

test('Boundary in middle of string', () => {
  const schema = s.string('str');

  const chunk1 = '"hello';
  const chunk2 = ' world"';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual(
    'hello world',
  );
});

test('Boundary in middle of escape sequence', () => {
  const schema = s.string('str');

  const chunk1 = '"a\\';
  const chunk2 = '\\b"';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual('a\\b');
});

test('Partial Unicode escape sequence', () => {
  const schema = s.string('str');

  const chunk1 = '"\\u0';
  const chunk2 = '00A"';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual('\n');
});

test('Number split at decimal point', () => {
  const schema = s.number('num');

  const chunk1 = '123.';
  const chunk2 = '456';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual(123.456);
});

test('Number split at exponent marker', () => {
  const schema = s.number('num');

  const chunk1 = '1e';
  const chunk2 = '+2';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual(1e2);
});

test('Empty array split', () => {
  const schema = s.array('arr', s.number('num'));

  const chunk1 = '[';
  const chunk2 = ']';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual([]);
});

test('Array split between elements', () => {
  const schema = s.array('arr', s.number('num'));

  const chunk1 = '[1,';
  const chunk2 = '2,3]';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual([1, 2, 3]);
});

test('Nested object split at inner boundary', () => {
  const schema = s.object('root', {
    x: s.object('nested', { y: s.object('inner', { z: s.number('z') }) }),
  });

  const chunk1 = '{"x":{"y":{';
  const chunk2 = '"z":4}}}';
  const combined = chunk1 + chunk2;

  expectNoMatch(parseChunkResult(schema, chunk1));
  expect(expectMatch(parseCompleteResult(schema, combined))).toEqual({
    x: { y: { z: 4 } },
  });
});

test('Boolean primitive value', () => {
  const schema = s.boolean('b');

  const result = parseCompleteResult(schema, 'true');

  expect(expectMatch(result)).toBe(true);
});

test('Trailing whitespace and newlines', () => {
  const schema = s.object('empty', {});

  const result = parseCompleteResult(schema, '{}  \n\n');

  expect(expectMatch(result)).toEqual({});
});

test('Malformed JSON mid-stream is invalid', () => {
  const schema = s.object('obj', { a: s.number('a') });

  expectInvalid(parseChunkResult(schema, '{"a":1,{}}'));
});

test('Unterminated string at EOF is invalid', () => {
  const schema = s.string('str');

  expectInvalid(parseCompleteResult(schema, '"oops'));
});

test('Streaming string emits partial content', () => {
  const schema = s.streaming.string('str');

  expect(expectMatch(parseChunkResult(schema, '"he'))).toEqual('he');
  expect(expectMatch(parseChunkResult(schema, '"hello'))).toEqual('hello');
  expect(expectMatch(parseCompleteResult(schema, '"hello"'))).toEqual('hello');
});

test('Streaming array emits elements incrementally', () => {
  const schema = s.streaming.array('arr', s.number('num'));

  expect(expectMatch(parseChunkResult(schema, '[1'))).toEqual([]);
  expect(expectMatch(parseChunkResult(schema, '[1,'))).toEqual([1]);
  expect(expectMatch(parseChunkResult(schema, '[1,2,'))).toEqual([1, 2]);
  expect(expectMatch(parseCompleteResult(schema, '[1,2,3]'))).toEqual([
    1, 2, 3,
  ]);
});

test('Streaming array in non-streaming object emits elements incrementally', () => {
  const schema = s.object('root', {
    data: s.streaming.array('arr', s.number('num')),
  });

  expect(expectMatch(parseChunkResult(schema, '{"data":[1'))).toEqual({
    data: [],
  });
  expect(expectMatch(parseChunkResult(schema, '{"data":[1,'))).toEqual({
    data: [1],
  });
  expect(expectMatch(parseChunkResult(schema, '{"data":[1,2,'))).toEqual({
    data: [1, 2],
  });
  expect(expectMatch(parseCompleteResult(schema, '{"data":[1,2,3]}'))).toEqual({
    data: [1, 2, 3],
  });
});

test('Object rejects extra properties', () => {
  const schema = s.object('obj', { a: s.number('a') });

  expectNoMatch(parseCompleteResult(schema, '{"a":1,"b":2}'));
});

test('Object rejects prototype pollution keys', () => {
  const schema = s.object('obj', { a: s.number('a') });

  expectNoMatch(parseCompleteResult(schema, '{"__proto__":{"x":1},"a":1}'));
});

test('anyOf ignores invalid options when another option can match', () => {
  const InvalidType = SchemaTypeCtor({
    name: 'Invalid',
    initializer: (inst, def) => {
      s.SchemaType.init(inst, def);
    },
    toJsonSchemaImpl: () => ({}),
    toTypeScriptImpl: () => 'invalid',
    fromJsonAstImpl: () => {
      return (input) => ({
        result: { state: 'invalid' },
        cache: input.cache ?? { byNodeId: {}, byNodeIdAndSchemaId: {} },
      });
    },
    validateImpl: () => {
      return;
    },
  });

  const invalid = new InvalidType({
    type: 'string',
    description: 'invalid',
    streaming: false,
  });
  const schema = s.anyOf([invalid, s.string('ok')]);

  expect(expectMatch(parseCompleteResult(schema, '"hello"'))).toBe('hello');
});

test('anyOf returns no-match when all non-invalid options do not match', () => {
  const InvalidType = SchemaTypeCtor({
    name: 'Invalid',
    initializer: (inst, def) => {
      s.SchemaType.init(inst, def);
    },
    toJsonSchemaImpl: () => ({}),
    toTypeScriptImpl: () => 'invalid',
    fromJsonAstImpl: () => {
      return (input) => ({
        result: { state: 'invalid' },
        cache: input.cache ?? { byNodeId: {}, byNodeIdAndSchemaId: {} },
      });
    },
    validateImpl: () => {
      return;
    },
  });

  const invalid = new InvalidType({
    type: 'string',
    description: 'invalid',
    streaming: false,
  });
  const schema = s.anyOf([invalid, s.number('num')]);

  expectNoMatch(parseCompleteResult(schema, '"hello"'));
});

test('Streaming object emits fields incrementally', () => {
  const schema = s.streaming.object('obj', {
    a: s.number('a'),
    b: s.number('b'),
  });

  expect(expectMatch(parseChunkResult(schema, '{"a":1,'))).toEqual({ a: 1 });
  expect(expectMatch(parseCompleteResult(schema, '{"a":1,"b":2}'))).toEqual({
    a: 1,
    b: 2,
  });
});

test('Streaming object initializes missing streaming string keys', () => {
  const schema = s.streaming.object('obj', {
    content: s.streaming.string('content'),
    citations: s.streaming.array('citations', s.string('citation')),
  });

  const result = parseChunkResult(schema, '{"citations":[]');

  expect(expectMatch(result)).toEqual({ content: '', citations: [] });
});

test('Streaming object initializes missing streaming array keys', () => {
  const schema = s.streaming.object('obj', {
    content: s.streaming.string('content'),
    citations: s.streaming.array('citations', s.string('citation')),
  });

  const result = parseChunkResult(schema, '{"content":"hi"');

  expect(expectMatch(result)).toEqual({ content: 'hi', citations: [] });
});

test('Streaming object initializes missing streaming object keys', () => {
  const schema = s.streaming.object('obj', {
    meta: s.streaming.object('meta', {
      tags: s.streaming.array('tags', s.string('tag')),
    }),
    content: s.streaming.string('content'),
  });

  const result = parseChunkResult(schema, '{"content":"hi"');

  expect(expectMatch(result)).toEqual({ meta: {}, content: 'hi' });
});

test('Streaming object does not initialize missing non-streaming keys', () => {
  const schema = s.streaming.object('obj', {
    content: s.streaming.string('content'),
    count: s.number('count'),
  });

  const result = parseChunkResult(schema, '{"content":"hi"');

  expect(expectMatch(result)).toEqual({ content: 'hi' });
});

test('Streaming object skips initialization for streaming objects with non-streaming children', () => {
  const schema = s.streaming.object('obj', {
    meta: s.streaming.object('meta', {
      count: s.number('count'),
    }),
    content: s.streaming.string('content'),
  });

  const result = parseChunkResult(schema, '{"content":"hi"');

  expect(expectMatch(result)).toEqual({ content: 'hi' });
});

test('Streaming object preserves initialized identity across chunks', () => {
  const schema = s.streaming.object('obj', {
    a: s.streaming.array('a', s.string('a')),
    b: s.streaming.array('b', s.string('b')),
  });

  const initialState = createParserState();

  const firstResult = applyChunk(
    schema,
    initialState,
    undefined,
    '{"a":["x"],',
  );

  expect(firstResult.result).toEqual({
    state: 'match',
    value: { a: ['x'], b: [] },
  });
  const firstValue =
    firstResult.result.state === 'match' ? firstResult.result.value : null;
  const firstA = firstValue?.a;
  const firstB = firstValue?.b;

  const secondResult = applyChunk(
    schema,
    firstResult.state,
    firstResult.cache,
    '"b":["y"]}',
  );

  expect(secondResult.result).toEqual({
    state: 'match',
    value: { a: ['x'], b: ['y'] },
  });
  const secondValue =
    secondResult.result.state === 'match' ? secondResult.result.value : null;

  expect(secondValue?.a).toBe(firstA);
  expect(secondValue?.b).not.toBe(firstB);
});

test('Whitespace-only fragments are ignored', () => {
  const schema = s.number('num');

  expectNoMatch(parseChunkResult(schema, '   \n'));
  expect(expectMatch(parseCompleteResult(schema, '   \n42'))).toEqual(42);
});

test('Missing closing brace at EOF is invalid', () => {
  const schema = s.object('obj', { a: s.number('a') });

  expectInvalid(parseCompleteResult(schema, '{"a":1'));
});

test('Extra data after valid JSON is invalid', () => {
  const schema = s.object('obj', { a: s.number('a') });

  expectInvalid(parseCompleteResult(schema, '{"a":1}garbage'));
});

describe('Wrapped primitives', () => {
  test('Boolean', () => {
    const schema = s.boolean('b');

    const result = parseCompleteResult(
      schema,
      JSON.stringify({
        [PRIMITIVE_WRAPPER_FIELD_NAME]: true,
      }),
    );

    expect(expectMatch(result)).toBe(true);
  });

  test('String', () => {
    const schema = s.string('s');

    const result = parseCompleteResult(
      schema,
      JSON.stringify({
        [PRIMITIVE_WRAPPER_FIELD_NAME]: 'string value',
      }),
    );

    expect(expectMatch(result)).toBe('string value');
  });

  test('Streaming string', () => {
    const schema = s.streaming.string('s');

    const result = parseChunkResult(
      schema,
      JSON.stringify({
        [PRIMITIVE_WRAPPER_FIELD_NAME]: 'string value',
      }).slice(0, -5),
    );

    expect(expectMatch(result)).toBe('string va');
  });

  test('Array', () => {
    const schema = s.array('a', s.string('a.s'));

    const result = parseCompleteResult(
      schema,
      JSON.stringify({
        [PRIMITIVE_WRAPPER_FIELD_NAME]: ['string value'],
      }),
    );

    expect(expectMatch(result)).toStrictEqual(['string value']);
  });
});

test('streaming string resolves open nodes while non-streaming waits for close', () => {
  const streamingSchema = s.streaming.string('streaming');
  const nonStreamingSchema = s.string('non-streaming');

  let state = createParserState();
  let cache: s.FromJsonAstCache | undefined;

  let result = applyChunk(streamingSchema, state, cache, '"he');
  state = result.state;
  cache = result.cache;
  expect(result.result).toEqual({ state: 'match', value: 'he' });

  const nonStreamingResult = s.fromJsonAst(
    nonStreamingSchema,
    state,
    undefined,
  );
  expect(nonStreamingResult.result.state).toBe('no-match');

  result = applyChunk(streamingSchema, state, cache, 'llo"');
  state = result.state;
  cache = result.cache;
  expect(result.result).toEqual({ state: 'match', value: 'hello' });

  const nonStreamingFinal = s.fromJsonAst(nonStreamingSchema, state, undefined);
  expect(nonStreamingFinal.result).toEqual({ state: 'match', value: 'hello' });
});

test('streaming array emits elements incrementally and caches when nothing new matches', () => {
  const schema = s.streaming.array('arr', s.string('str'));

  let state = createParserState();
  let cache: s.FromJsonAstCache | undefined;

  let result = applyChunk(schema, state, cache, '["a","b');
  state = result.state;
  cache = result.cache;
  expect(result.result).toEqual({ state: 'match', value: ['a'] });
  const first = result.result.state === 'match' ? result.result.value : null;

  result = applyChunk(schema, state, cache, 'c');
  state = result.state;
  cache = result.cache;
  expect(result.result).toEqual({ state: 'match', value: ['a'] });
  const second = result.result.state === 'match' ? result.result.value : null;
  expect(second).toBe(first);
});

test('non-streaming array requires a closed array', () => {
  const schema = s.array('arr', s.number('num'));

  let state = createParserState();

  let result = applyChunk(schema, state, undefined, '[1,2,');
  state = result.state;
  const cache = result.cache;
  expect(result.result.state).toBe('no-match');

  result = applyChunk(schema, state, cache, '3]');
  expect(result.result).toEqual({ state: 'match', value: [1, 2, 3] });
});

test('non-streaming object matches when all keys are present even if open', () => {
  const schema = s.object('obj', {
    a: s.number('a'),
  });

  const result = applyChunk(schema, createParserState(), undefined, '{"a":1,');
  expect(result.result).toEqual({ state: 'match', value: { a: 1 } });
});

test('non-streaming object initializes missing streaming string keys', () => {
  const schema = s.object('obj', {
    text: s.streaming.string('text'),
    count: s.number('count'),
  });

  const result = applyChunk(
    schema,
    createParserState(),
    undefined,
    '{"count":1,',
  );

  expect(result.result).toEqual({
    state: 'match',
    value: { text: '', count: 1 },
  });
});

test('non-streaming object initializes missing streaming array keys', () => {
  const schema = s.object('obj', {
    items: s.streaming.array('items', s.string('item')),
    count: s.number('count'),
  });

  const result = applyChunk(
    schema,
    createParserState(),
    undefined,
    '{"count":1,',
  );

  expect(result.result).toEqual({
    state: 'match',
    value: { items: [], count: 1 },
  });
});

test('non-streaming object initializes missing streaming object keys', () => {
  const schema = s.object('obj', {
    meta: s.streaming.object('meta', {
      tags: s.streaming.array('tags', s.string('tag')),
    }),
    count: s.number('count'),
  });

  const result = applyChunk(
    schema,
    createParserState(),
    undefined,
    '{"count":1,',
  );

  expect(result.result).toEqual({
    state: 'match',
    value: { meta: {}, count: 1 },
  });
});

test('non-streaming object requires all keys to be present', () => {
  const schema = s.object('obj', {
    a: s.number('a'),
    b: s.number('b'),
  });

  const state = parseChunk(createParserState(), '{"a":1,');
  const result = s.fromJsonAst(schema, state, undefined);
  expect(result.result.state).toBe('no-match');
});

test('match with null is distinct from no-match', () => {
  const schema = s.nullish();

  let state = createParserState();

  let result = applyChunk(schema, state, undefined, 'nu');
  state = result.state;
  const cache = result.cache;
  expect(result.result.state).toBe('no-match');

  result = applyChunk(schema, state, cache, 'll');
  expect(result.result.state).toBe('match');
  if (result.result.state === 'match') {
    expect(result.result.value).toBeNull();
  }
});

test('anyOf picks the first match and propagates invalid parser states', () => {
  const ordered = s.anyOf([
    s.node(s.streaming.string('first')),
    s.streaming.string('second'),
  ]);

  const state = parseChunk(createParserState(), '"hi');
  const orderedResult = s.fromJsonAst(ordered, state, undefined);
  expect(orderedResult.result.state).toBe('match');
  if (orderedResult.result.state === 'match') {
    expect(orderedResult.result.value).toEqual({
      complete: false,
      partialValue: 'hi',
      value: 'hi',
    });
  }

  const errorState = parseChunk(createParserState(), '{"a":1,]');
  expect(errorState.error).not.toBeNull();
  const invalidResult = s.fromJsonAst(ordered, errorState, undefined);
  expect(invalidResult.result.state).toBe('invalid');
});

test('node exposes parser state even when inner schema does not match', () => {
  const schema = s.node(s.string('inner'));

  let state = createParserState();

  let result = applyChunk(schema, state, undefined, '"he');
  state = result.state;
  const cache = result.cache;
  expect(result.result.state).toBe('match');
  if (result.result.state === 'match') {
    expect(result.result.value).toEqual({
      complete: false,
      partialValue: 'he',
      value: undefined,
    });
  }

  result = applyChunk(schema, state, cache, 'llo"');
  expect(result.result.state).toBe('match');
  if (result.result.state === 'match') {
    expect(result.result.value).toEqual({
      complete: true,
      partialValue: 'hello',
      value: 'hello',
    });
  }
});

describe('anyOf', () => {
  test('anyOf flattened parsing', () => {
    const schema = s.object('root', {
      value: s.anyOf([s.number('num'), s.string('str')]),
    });
    const input = '{"value":123}';
    const input2 = '{"value":"hello"}';

    expect(expectMatch(parseCompleteResult(schema, input))).toEqual({
      value: 123,
    });
    expect(expectMatch(parseCompleteResult(schema, input2))).toEqual({
      value: 'hello',
    });
  });

  test('anyOf envelope parsing across chunks (number branch)', () => {
    const schema = s.object('root', {
      value: s.anyOf([s.number('num'), s.string('str')]),
    });
    const chunk1 = '{"value":';
    const chunk2 = '123}';
    const combined = chunk1 + chunk2;

    expectNoMatch(parseChunkResult(schema, chunk1));
    expect(expectMatch(parseCompleteResult(schema, combined))).toEqual({
      value: 123,
    });
  });

  test('anyOf envelope parsing across chunks (string branch)', () => {
    const schema = s.object('root', {
      value: s.anyOf([s.number('num'), s.streaming.string('str')]),
    });

    const chunk1 = '{"value":"he';
    const chunk2 = 'llo"}';
    const combined = chunk1 + chunk2;

    expect(expectMatch(parseChunkResult(schema, chunk1))).toEqual({
      value: 'he',
    });
    expect(expectMatch(parseCompleteResult(schema, combined))).toEqual({
      value: 'hello',
    });
  });

  test('object with anyOf of object', () => {
    const schema = s.object('outerObject', {
      element: s.anyOf([
        s.object('innerObject', {
          data: s.streaming.string('streaming data'),
        }),
      ]),
    });

    const chunk1 = '{"element":{"data":"stream';
    const chunk2 = 'ing data"}}';
    const combined = chunk1 + chunk2;

    expect(expectMatch(parseChunkResult(schema, chunk1))).toEqual({
      element: {
        data: 'stream',
      },
    });
    expect(expectMatch(parseCompleteResult(schema, combined))).toEqual({
      element: {
        data: 'streaming data',
      },
    });
  });

  test('streaming array with anyOf with mix of types', () => {
    const schema = s.streaming.array(
      'streaming array',
      s.anyOf([
        s.number('array number'),
        s.object('array object', {
          data: s.streaming.string('array object streaming data'),
        }),
        s.boolean('array boolean'),
      ]),
    );

    const chunk1 = '[{"data":"the';
    const chunk2 = ' markdown data"},17,';
    const chunk3 = 'false,12';
    const chunk4 = '3,{"data":"more markdown data"}]';

    expect(expectMatch(parseChunkResult(schema, chunk1))).toEqual([
      { data: 'the' },
    ]);
    expect(expectMatch(parseChunkResult(schema, chunk1 + chunk2))).toEqual([
      { data: 'the markdown data' },
      17,
    ]);
    expect(
      expectMatch(parseChunkResult(schema, chunk1 + chunk2 + chunk3)),
    ).toEqual([{ data: 'the markdown data' }, 17, false]);
    expect(
      expectMatch(
        parseCompleteResult(schema, chunk1 + chunk2 + chunk3 + chunk4),
      ),
    ).toEqual([
      { data: 'the markdown data' },
      17,
      false,
      123,
      { data: 'more markdown data' },
    ]);
  });

  test('ui client schema', () => {
    const schema = s.object('UI', {
      ui: s.streaming.array(
        'list of elements',
        s.anyOf([
          s.object('Show markdown to the user', {
            $tagName: s.literal('app-markdown'),
            $props: s.object('Props', {
              data: s.streaming.string('The markdown content'),
            }),
          }),
        ]),
      ),
    });

    const jsonString = JSON.stringify({
      ui: [
        {
          $tagName: 'app-markdown',
          $props: { data: 'Hello! How can I assist you today?' },
        },
      ],
    });

    const chunk1 = jsonString.slice(0, 15);
    const chunk2 = jsonString.slice(15, 30);
    const chunk3 = jsonString.slice(30, 60);
    const chunk4 = jsonString.slice(60);

    expect(expectMatch(parseChunkResult(schema, chunk1))).toEqual({ ui: [] });
    expect(expectMatch(parseChunkResult(schema, chunk1 + chunk2))).toEqual({
      ui: [],
    });
    expect(
      expectMatch(parseChunkResult(schema, chunk1 + chunk2 + chunk3)),
    ).toEqual({
      ui: [
        {
          $props: {
            data: 'Hello! H',
          },
          $tagName: 'app-markdown',
        },
      ],
    });
    expect(
      expectMatch(
        parseCompleteResult(schema, chunk1 + chunk2 + chunk3 + chunk4),
      ),
    ).toEqual({
      ui: [
        {
          $props: {
            data: 'Hello! How can I assist you today?',
          },
          $tagName: 'app-markdown',
        },
      ],
    });
  });

  test('streaming array with anyOf with anyOf', () => {
    const schema = s.streaming.array(
      'streaming array',
      s.anyOf([
        s.anyOf([
          s.streaming.string('array object streaming data'),
          s.literal('anyOf anyOf literal'),
        ]),
        s.number('array number'),
        s.boolean('array boolean'),
      ]),
    );

    const data = [
      'streaming string in inner anyOf',
      17,
      false,
      123,
      'anyOf anyOf literal',
    ];

    const asJson = JSON.stringify(data);

    expect(expectMatch(parseCompleteResult(schema, asJson))).toEqual([
      'streaming string in inner anyOf',
      17,
      false,
      123,
      'anyOf anyOf literal',
    ]);
  });

  test('streaming with multiple anyOfs in the schema', () => {
    const schema = s.object('root', {
      fieldA: s.anyOf([s.streaming.string(''), s.nullish()]),
      fieldB: s.anyOf([s.streaming.string(''), s.nullish()]),
    });

    const chunk1 = '{"fieldA":"hello","fieldB":';
    const chunk2 = 'null}';

    expectNoMatch(parseChunkResult(schema, chunk1));
    expect(expectMatch(parseCompleteResult(schema, chunk1 + chunk2))).toEqual({
      fieldA: 'hello',
      fieldB: null,
    });
  });

  test('using a literal in anyOf objects for customized discriminators', () => {
    const schema = s.object('root', {
      ui: s.streaming.array(
        'list of elements',
        s.anyOf([
          s.object('Show markdown to the user', {
            $tagName: s.literal('app-markdown'),
            $props: s.object('Props', {
              data: s.streaming.string('The markdown content'),
            }),
          }),
          s.object('Show a button to the user', {
            $tagName: s.literal('app-button'),
            $props: s.object('Props', {
              data: s.streaming.string('The button content'),
            }),
          }),
        ]),
      ),
    });

    const jsonString = JSON.stringify({
      ui: [
        {
          $tagName: 'app-markdown',
          $props: { data: 'Hello! How can I assist you today?' },
        },
      ],
    });

    expect(expectMatch(parseCompleteResult(schema, jsonString))).toEqual({
      ui: [
        {
          $props: { data: 'Hello! How can I assist you today?' },
          $tagName: 'app-markdown',
        },
      ],
    });
  });

  test('using a literal in anyOf objects for customized discriminators with partial response', () => {
    const schema = s.object('root', {
      ui: s.streaming.array(
        'list of elements',
        s.anyOf([
          s.object('Show markdown to the user', {
            $tagName: s.literal('app-markdown'),
            $props: s.object('Props', {
              data: s.streaming.string('The markdown content'),
            }),
          }),
          s.object('Show a button to the user', {
            $tagName: s.literal('app-button'),
            $props: s.object('Props', {
              data: s.streaming.string('The button content'),
            }),
          }),
        ]),
      ),
    });

    const jsonString = JSON.stringify({
      ui: [
        {
          $tagName: 'app-markdown',
          $props: { data: 'Hello! How can I assist you today?' },
        },
      ],
    });

    expect(
      expectMatch(
        parseChunkResult(schema, jsonString.slice(0, jsonString.length - 25)),
      ),
    ).toEqual({
      ui: [
        {
          $props: { data: 'Hello! How can' },
          $tagName: 'app-markdown',
        },
      ],
    });
  });

  test('anyOf picks the first matching object when multiple match', () => {
    const schema = s.object('root', {
      ui: s.streaming.array(
        'list of elements',
        s.anyOf([
          s.object('First option', {
            $tagName: s.literal('app-markdown'),
          }),
          s.object('Second option', {
            $tagName: s.string('some string'),
          }),
        ]),
      ),
    });

    const jsonString = JSON.stringify({
      ui: [
        {
          $tagName: 'app-markdown',
        },
      ],
    });

    expect(expectMatch(parseCompleteResult(schema, jsonString))).toEqual({
      ui: [
        {
          $tagName: 'app-markdown',
        },
      ],
    });
  });
});
