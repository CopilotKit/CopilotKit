# @copilotkit/schema

Small, fast, strictly typed schema validation for TypeScript.

This package is an unreleased preview. It targets the schema, composition,
async, metadata, codec, and JSON Schema work used in most TypeScript apps
through a tree-shakeable functional API. Its bundle and speed claims come from
checked benchmarks. See [COMPATIBILITY.md](COMPATIBILITY.md) for tested
coverage and open work.

## Streaming JSON

Add `streaming()` in a schema pipeline to mark the ordered point where partial
string, object, or array output becomes usable. Parser state and resolution
cache are plain immutable values: pass the returned state into the next call.
Checks and transforms before `streaming()` run again from the current raw value
as each chunk arrives. Keep them pure, deterministic, bounded, and safe to
repeat. Defaults, fallbacks, async actions, and actions after `streaming()` run
only during final validation.

```ts
import {
  createParserState,
  createResolutionCache,
  object,
  parseChunk,
  resolveStreamingValue,
  schema,
  streaming,
  string,
} from "@copilotkit/schema";

const props = schema(
  object({ title: schema(string(), streaming()) }),
  streaming(),
);
let parser = createParserState();
let cache = createResolutionCache();

const parsed = parseChunk(parser, '{"title":"Hel');
parser = parsed.state;
const resolved = resolveStreamingValue(props, parsed, cache);
cache = resolved.cache;
```

Call `finalizeJsonParse` when the JSON stream ends, then call
`validateFinalValue` to run the complete schema, including actions after the
streaming checkpoint. The parser defaults to 64 KiB of UTF-8 JSON, 32 nested
containers, and 10,000 JSON nodes.

## Use

```ts
import {
  array,
  boolean,
  minLength,
  number,
  object,
  optional,
  parse,
  schema,
  string,
  transform,
  trim,
} from "@copilotkit/schema";

const Username = schema(
  string(),
  trim(),
  minLength(3),
  transform((value) => value.toLowerCase()),
);

const User = object({
  active: boolean(),
  age: number(),
  name: Username,
  nickname: optional(string()),
  tags: array(string()),
});

const user = parse(User, {
  active: true,
  age: 37,
  name: "Ada",
  tags: ["math", "code"],
});
// user: {
//   active: boolean;
//   age: number;
//   name: string;
//   nickname?: string;
//   tags: string[];
// }
```

`parse` throws `ValidationError` for bad input. `safeParse` returns a typed
success or failure result. Nested issues include their object keys and array
indexes.

Every schema also implements
[Standard Schema v1](https://standardschema.dev/), so libraries can consume it
without a package-specific adapter.

## Type tests

Run the golden type suite:

```sh
pnpm --dir packages/schema test:types
```

Vitest asks TypeScript to check each `*.test-d.ts` file. The suite locks schema
input, output, composition, wrapper, parser, action, and public helper types.
Ten golden cases compare inferred types with ArkType, Valibot, and Zod. Another
21 runtime cases compare the same inputs, outputs, errors, and interop paths.

## Size

The bundle check builds the same object-and-array schema with esbuild 0.19.12.
It imports each published ESM entry, enables tree shaking and minification, and
targets ES2022 browsers.

| Package                    |  Minified |     gzip |   Brotli |
| -------------------------- | --------: | -------: | -------: |
| `@copilotkit/schema`       |   6,321 B |  2,250 B |  1,999 B |
| `arktype@2.2.3`            | 153,507 B | 47,087 B | 41,416 B |
| `valibot@1.3.1`            |   3,691 B |  1,296 B |  1,146 B |
| `zod@4.3.6` via `zod/mini` |  17,896 B |  6,354 B |  5,756 B |

Run the check:

```sh
pnpm nx run @copilotkit/schema:build
pnpm --dir packages/schema benchmark:bundle
```

The suite also checks isolated scalar and union consumers. Their minified
sizes are 4,560 B and 5,726 B. The package test fails if any checked fixture
stops being smaller than any comparison in minified, gzip, or Brotli form.
It also fails if any fixture exceeds its compact schema budget.

## Speed

Stateless leaf factories reuse lazy flyweight schemas. Sync schemas share
constant metadata and their lazy Standard Schema adapter through one compact
constructor prototype. Composite factories add fields to that schema object,
and object schemas defer and cache their keys. Each schema keeps a direct
validation closure. Valid object and array parses do not allocate issue arrays.

On an Apple Silicon Mac with Node.js 22.22.3, seven rotated rounds produced
these median operations per second:

| Scenario         | `@copilotkit/schema` |     ArkType |    Valibot |   Zod Mini |
| ---------------- | -------------------: | ----------: | ---------: | ---------: |
| Valid object     |           11,344,042 |     509,784 |  5,326,487 |  6,278,522 |
| Invalid object   |            4,380,585 |     133,810 |  2,384,870 |    207,517 |
| Union            |          342,426,820 | 186,514,968 | 13,102,210 | 23,212,449 |
| Transform        |          404,749,492 |  75,466,959 | 35,417,036 | 70,748,877 |
| Construction     |            7,842,394 |      40,742 |  1,389,633 |    113,572 |
| Recursive object |            5,899,995 |   1,803,666 |    543,831 |  3,547,766 |

The sequential async-transform check is at parity with ArkType. One run
produced 38,497,074 operations per second for this package, 38,067,444 for
ArkType, 11,863,498 for Zod Mini, and 5,078,148 for Valibot. Its gate allows
5% run-to-run noise.

The cold benchmark constructs an object schema and parses once. It measured
5,930,128 operations per second for this package, 44,084 for ArkType, 1,868,302
for Valibot, and 202,576 for Zod Mini. Retained heap use was 528 B, 909 B,
1,872 B, and 9,192 B per schema. Fresh-process imports took 1.34 ms, 68.98 ms,
2.54 ms, and 12.34 ms.

Run the benchmark on the target machine:

```sh
pnpm --dir packages/schema benchmark
pnpm --dir packages/schema benchmark:async
pnpm --dir packages/schema benchmark:cold
```

These small synthetic checks compare hot paths, not whole applications.

## Current API

- Schemas cover primitives, literals, objects, records, arrays, tuples, maps,
  sets, functions, promises, unions, variants, intersections, and recursion.
- Wrappers cover optional, exact optional, nullable, nullish, undefinedable,
  non-presence, defaults, and fallback values.
- Methods include sync and async parse helpers, reusable parsers, assertions,
  predicates, codecs, JSON Schema output, and object schema utilities.
- `schema` and `schemaAsync` turn ordered checks and transforms into reusable
  schemas with coercion, brands, readonly output, issue forwarding, item
  transforms, and format checks.
- Metadata includes titles, descriptions, examples, and typed registries.
- Errors include typed paths, sibling and union branch issues, localized
  messages, flattened issue maps, and text summaries.
- Every schema implements Standard Schema v1.
