import { expect, test } from "vitest";

import {
  array,
  check,
  createParserState,
  createResolutionCache,
  fallback,
  finalizeJsonParse,
  getStreamStatus,
  literal,
  number,
  object,
  optional,
  parseChunk,
  resolveStreamingValue,
  schema,
  schemaAsync,
  streaming,
  string,
  transform,
  transformAsync,
  union,
  validateFinalValue,
} from "../index.js";

function parse(text: string) {
  return parseChunk(createParserState(), text);
}

test("streams Hashbrown-style strings, objects, arrays, and nested values", () => {
  const props = schema(
    object({
      title: schema(string(), streaming()),
      tags: schema(array(schema(string(), streaming())), streaming()),
    }),
    streaming(),
  );
  const parsed = parse('{"title":"hel","tags":["one","tw');

  const result = resolveStreamingValue(props, parsed, createResolutionCache());

  expect(result).toMatchObject({
    status: "match",
    changed: true,
    value: { title: "hel", tags: ["one", "tw"] },
  });
  if (result.status === "match") {
    expect(getStreamStatus(result.readiness, ["title"])).toBe("complete");
    expect(getStreamStatus(result.readiness, ["tags", 0])).toBe("complete");
    expect(getStreamStatus(result.readiness, ["tags", 1])).toBe("partial");
  }
});

test("withholds partial escapes and unicode until their decoded value is valid", () => {
  const props = schema(string(), streaming());
  const cache = createResolutionCache();
  const escape = parseChunk(createParserState(), '"hi\\');
  const unicodePrefix = parseChunk(escape.state, "u26");
  const unicodeComplete = parseChunk(unicodePrefix.state, "3A");

  const first = resolveStreamingValue(props, escape, cache);
  const second = resolveStreamingValue(props, unicodePrefix, first.cache);
  const third = resolveStreamingValue(props, unicodeComplete, second.cache);

  expect(first).toMatchObject({ status: "match", value: "hi" });
  expect(second).toMatchObject({
    status: "match",
    value: "hi",
    changed: false,
  });
  expect(third).toMatchObject({ status: "match", value: "hi☺" });
});

test("synthesizes safe empty streaming children and retains their identity", () => {
  const props = schema(
    object({
      child: schema(
        object({ title: schema(string(), streaming()) }),
        streaming(),
      ),
      items: schema(array(string()), streaming()),
      title: schema(string(), streaming()),
    }),
    streaming(),
  );
  const first = resolveStreamingValue(
    props,
    parse("{"),
    createResolutionCache(),
  );
  const second = resolveStreamingValue(props, parse("{ "), first.cache);

  expect(first).toMatchObject({
    status: "match",
    value: { child: { title: "" }, items: [], title: "" },
  });
  expect(second).toMatchObject({ status: "match", changed: false });
  if (first.status === "match" && second.status === "match") {
    expect(second.value).toBe(first.value);
    expect(second.value.child).toBe(first.value.child);
    expect(second.value.items).toBe(first.value.items);
  }
});

test("withholds a streaming object until required non-streaming children exist", () => {
  const props = schema(
    object({
      meta: schema(object({ count: number() }), streaming()),
    }),
    streaming(),
  );

  const missing = resolveStreamingValue(
    props,
    parse("{"),
    createResolutionCache(),
  );
  const openMeta = resolveStreamingValue(
    props,
    parse('{"meta":{'),
    createResolutionCache(),
  );

  expect(missing.status).toBe("no-match");
  expect(openMeta.status).toBe("no-match");
});

test("finds a nested streaming checkpoint through an optional wrapper", () => {
  const props = schema(
    object({
      subtitle: optional(schema(string(), streaming())),
    }),
    streaming(),
  );

  const present = resolveStreamingValue(
    props,
    parse('{"subtitle":"hel'),
    createResolutionCache(),
  );
  const absent = resolveStreamingValue(
    props,
    parse("{"),
    createResolutionCache(),
  );

  expect(present).toMatchObject({
    status: "match",
    value: { subtitle: "hel" },
  });
  expect(absent).toMatchObject({ status: "match", value: {} });
});

test("keeps parent and child streaming checkpoints local", () => {
  const childOnly = object({ title: schema(string(), streaming()) });
  const parentOnly = schema(object({ title: string() }), streaming());
  const both = schema(
    object({ title: schema(string(), streaming()) }),
    streaming(),
  );

  expect(
    resolveStreamingValue(
      childOnly,
      parse('{"title":"hel'),
      createResolutionCache(),
    ),
  ).toMatchObject({ status: "match", value: { title: "hel" } });
  expect(
    resolveStreamingValue(
      parentOnly,
      parse('{"title":"hel'),
      createResolutionCache(),
    ).status,
  ).toBe("no-match");
  expect(
    resolveStreamingValue(
      parentOnly,
      parse('{"title":"hello"'),
      createResolutionCache(),
    ),
  ).toMatchObject({ status: "match", value: { title: "hello" } });
  expect(
    resolveStreamingValue(
      both,
      parse('{"title":"hel'),
      createResolutionCache(),
    ),
  ).toMatchObject({ status: "match", value: { title: "hel" } });
});

test("resolves the first matching streaming union branch", () => {
  const props = union([
    schema(string(), streaming()),
    schema(
      object({
        kind: literal("card"),
        title: schema(string(), streaming()),
      }),
      streaming(),
    ),
  ]);

  const text = resolveStreamingValue(
    props,
    parse('"hel'),
    createResolutionCache(),
  );
  const card = resolveStreamingValue(
    props,
    parse('{"kind":"card","title":"hel'),
    createResolutionCache(),
  );

  expect(text).toMatchObject({ status: "match", value: "hel" });
  expect(card).toMatchObject({
    status: "match",
    value: { kind: "card", title: "hel" },
  });
});

test("withholds failed transient checks and reruns transforms from raw partial input", () => {
  const props = schema(
    string(),
    transform((value: string) => value.toUpperCase()),
    check((value: string) => value.length >= 3),
    streaming(),
  );
  const cache = createResolutionCache();
  const tooShort = resolveStreamingValue(props, parse('"hi'), cache);
  const longEnough = resolveStreamingValue(
    props,
    parse('"hey'),
    tooShort.cache,
  );

  expect(tooShort.status).toBe("no-match");
  expect(tooShort.cache.readiness["[]"]).toBe("missing");
  expect(longEnough).toMatchObject({ status: "match", value: "HEY" });
});

test("marks a closed node invalid when checkpoint actions cannot pass", () => {
  const props = schema(
    string(),
    check((value: string) => value.length >= 3),
    streaming(),
  );

  const result = resolveStreamingValue(
    props,
    parse('"no"'),
    createResolutionCache(),
  );

  expect(result).toMatchObject({
    status: "invalid",
    error: { code: "schema_invalid" },
    cache: { readiness: { "[]": "invalid" } },
  });
});

test("retains identity for unchanged branches and withholds an unmatched array tail", () => {
  const props = schema(
    object({
      items: schema(array(string()), streaming()),
      title: schema(string(), streaming()),
    }),
    streaming(),
  );
  const first = resolveStreamingValue(
    props,
    parse('{"items":["a"],"title":"x'),
    createResolutionCache(),
  );
  const second = resolveStreamingValue(
    props,
    parse('{"items":["a",1],"title":"xy'),
    first.cache,
  );

  expect(first.status).toBe("match");
  expect(second.status).toBe("match");
  if (first.status === "match" && second.status === "match") {
    expect(second.value.items).toBe(first.value.items);
    expect(second.value).not.toBe(first.value);
  }
});

test("runs the full schema once against raw complete JSON during final validation", async () => {
  const props = schema(
    string(),
    streaming(),
    transform((value: string) => `${value}!`),
  );
  const parsed = parse('"done"');
  const finalized = finalizeJsonParse(parsed.state);

  const result = await validateFinalValue(props, finalized);

  expect(result).toEqual({ success: true, value: "done!" });
});

test("keeps async actions after the checkpoint on the final-only path", async () => {
  const props = schemaAsync(
    schema(string(), streaming()),
    transformAsync(async (value: string) => `${value}!`),
  );
  const parsed = parse('"done"');
  const partial = resolveStreamingValue(props, parsed, createResolutionCache());
  const final = await validateFinalValue(
    props,
    finalizeJsonParse(parsed.state),
  );

  expect(partial).toMatchObject({ status: "match", value: "done" });
  expect(final).toEqual({ success: true, value: "done!" });
});

test("keeps same-pipeline async actions after the checkpoint final-only", async () => {
  const props = schemaAsync(
    string(),
    streaming(),
    transformAsync(async (value: string) => `${value}!`),
  );
  const parsed = parse('"done');
  const partial = resolveStreamingValue(props, parsed, createResolutionCache());
  const final = await validateFinalValue(
    props,
    finalizeJsonParse(parseChunk(parsed.state, '"').state),
  );

  expect(partial).toMatchObject({ status: "match", value: "done" });
  expect(final).toEqual({ success: true, value: "done!" });
});

test("runs defaults and fallbacks only during final validation", async () => {
  const props = object({
    defaulted: optional(schema(string(), streaming()), "default"),
    recovered: fallback(
      schema(
        string(),
        check((value: string) => value.length >= 3),
        streaming(),
      ),
      "fallback",
    ),
  });
  const parsed = parse('{"recovered":"no"}');
  const partial = resolveStreamingValue(props, parsed, createResolutionCache());
  const final = await validateFinalValue(
    props,
    finalizeJsonParse(parsed.state),
  );

  expect(partial.status).toBe("invalid");
  expect(final).toEqual({
    success: true,
    value: { defaulted: "default", recovered: "fallback" },
  });
});

test("preserves resource limit details through streaming resolution", () => {
  const parsed = parseChunk(createParserState({ maxBytes: 3 }), '"four"');
  const result = resolveStreamingValue(
    schema(string(), streaming()),
    parsed,
    createResolutionCache(),
  );

  expect(result).toMatchObject({
    status: "invalid",
    error: { code: "max_bytes", limit: 3, observed: 6 },
    cache: { readiness: { "[]": "invalid" } },
  });
});

test("rejects async actions before a streaming checkpoint", () => {
  const schemaAsyncUnchecked = schemaAsync as unknown as (
    schema_: ReturnType<typeof string>,
    ...actions: unknown[]
  ) => unknown;

  expect(() =>
    schemaAsyncUnchecked(
      string(),
      transformAsync(async (value: string) => value.toUpperCase()),
      streaming(),
    ),
  ).toThrow("Async actions cannot run before a streaming checkpoint");
});

test("awaits third-party Standard Schema validation on the final-only path", async () => {
  const thirdParty = {
    "~standard": {
      version: 1 as const,
      vendor: "third-party",
      validate: async (value: unknown) => ({ value: String(value) }),
    },
  };
  const parsed = parse("42");

  const final = await validateFinalValue(
    thirdParty,
    finalizeJsonParse(parsed.state),
  );

  expect(final).toEqual({ success: true, value: "42" });
});
