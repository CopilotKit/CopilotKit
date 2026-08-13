import { expect, test } from "vitest";

import {
  createParserState,
  finalizeJsonParse,
  getResolvedValue,
  parseChunk,
} from "../index.js";

test("parses partial JSON without mutating prior parser state", () => {
  const initial = createParserState();

  const first = parseChunk(initial, '{"message":"hel');
  const second = parseChunk(first.state, 'lo","items":[1');

  expect(initial.nodes).toEqual([]);
  expect(first.error).toBeUndefined();
  expect(first.state.nodes[first.state.rootId!]?.resolvedValue).toEqual({
    message: "hel",
  });
  expect(second.state.nodes[second.state.rootId!]?.resolvedValue).toEqual({
    message: "hello",
    items: [undefined],
  });
});

test("finalizes complete JSON and reports structured incomplete JSON errors", () => {
  const complete = parseChunk(createParserState(), '{"ok":true}');
  const completeFinal = finalizeJsonParse(complete.state);
  const incomplete = parseChunk(createParserState(), '{"ok":');
  const incompleteFinal = finalizeJsonParse(incomplete.state);

  expect(getResolvedValue(completeFinal.state)).toEqual({ ok: true });
  expect(incompleteFinal.error).toMatchObject({
    code: "unexpected_end",
    index: 6,
    line: 1,
    column: 7,
  });
});

test("enforces raw byte, depth, and node limits", () => {
  const bytes = parseChunk(createParserState({ maxBytes: 3 }), '"four"');
  const depth = parseChunk(createParserState({ maxDepth: 1 }), "[[1]]");
  const nodes = parseChunk(createParserState({ maxNodes: 2 }), "[1,2]");

  expect(bytes.error).toMatchObject({
    code: "max_bytes",
    limit: 3,
    observed: 6,
  });
  expect(depth.error).toMatchObject({
    code: "max_depth",
    limit: 1,
    observed: 2,
  });
  expect(nodes.error).toMatchObject({
    code: "max_nodes",
    limit: 2,
    observed: 3,
  });
});

test("counts a split surrogate pair once for UTF-8 byte limits", () => {
  const first = parseChunk(createParserState({ maxBytes: 6 }), '"\ud83d');
  const second = parseChunk(first.state, '\ude00"');

  expect(second.error).toBeUndefined();
  expect(getResolvedValue(finalizeJsonParse(second.state).state)).toBe("😀");
});

test("produces the same final value across every two-chunk boundary", () => {
  const json = '{"text":"hello \\u263A","items":[true,false,null,12.3]}';
  const expected = JSON.parse(json);

  for (let split = 0; split <= json.length; split += 1) {
    const first = parseChunk(createParserState(), json.slice(0, split));
    const second = parseChunk(first.state, json.slice(split));
    const final = finalizeJsonParse(second.state);

    expect(final.error, `split ${split}`).toBeUndefined();
    expect(getResolvedValue(final.state), `split ${split}`).toEqual(expected);
  }
});

test("produces the same final value across every three-chunk partition", () => {
  const json = '{"text":"hi \\u263A","items":[true,12.3]}';
  const expected = JSON.parse(json);

  for (let first = 0; first <= json.length; first += 1) {
    for (let second = first; second <= json.length; second += 1) {
      const a = parseChunk(createParserState(), json.slice(0, first));
      const b = parseChunk(a.state, json.slice(first, second));
      const c = parseChunk(b.state, json.slice(second));
      const final = finalizeJsonParse(c.state);

      expect(final.error, `partition ${first}/${second}`).toBeUndefined();
      expect(
        getResolvedValue(final.state),
        `partition ${first}/${second}`,
      ).toEqual(expected);
    }
  }
});

test("preserves parser sibling and nested resolved identities", () => {
  const first = parseChunk(
    createParserState(),
    '{"left":{"items":[1]},"right":"a',
  );
  const rootBefore = first.state.nodes[first.state.rootId!];
  expect(rootBefore.type).toBe("object");
  if (rootBefore.type !== "object") throw new Error("Expected object root");
  const leftId = rootBefore.children[rootBefore.keys.indexOf("left")]!;
  const leftBefore = first.state.nodes[leftId]!;
  const leftValueBefore = leftBefore.resolvedValue;

  const second = parseChunk(first.state, 'b"}');
  const rootAfter = second.state.nodes[second.state.rootId!];
  const leftAfter = second.state.nodes[leftId]!;

  expect(leftAfter).toBe(leftBefore);
  expect(leftAfter.resolvedValue).toBe(leftValueBefore);
  expect(rootAfter).not.toBe(rootBefore);
  expect(rootAfter.resolvedValue).not.toBe(rootBefore.resolvedValue);
});

test("returns malformed number and literal errors without throwing", () => {
  const numberResult = parseChunk(createParserState(), "1e]");
  const literalResult = parseChunk(createParserState(), "truX");

  expect(numberResult.error).toMatchObject({
    code: "syntax_error",
    message: "Invalid number",
    index: 2,
    line: 1,
    column: 3,
  });
  expect(literalResult.error).toMatchObject({
    code: "syntax_error",
    message: "Invalid literal",
    index: 3,
    line: 1,
    column: 4,
  });
});

test("keeps unsafe object keys as data properties", () => {
  const parsed = parseChunk(
    createParserState(),
    '{"__proto__":{"polluted":true},"constructor":"safe"}',
  );
  const value = getResolvedValue(
    finalizeJsonParse(parsed.state).state,
  ) as Record<string, unknown>;

  expect(Object.hasOwn(value, "__proto__")).toBe(true);
  expect(value.__proto__).toEqual({ polluted: true });
  expect(value.constructor).toBe("safe");
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});
