import { expectTypeOf, test } from "vitest";

import {
  array,
  getStreamStatus,
  literal,
  number,
  object,
  schema,
  schemaAsync,
  streaming,
  string,
  transform,
  transformAsync,
  union,
} from "../index.js";
import type { InferOutput, InferStream, StreamReadiness } from "../index.js";

test("streaming preserves final output and infers nested partial output", () => {
  const props = schema(
    object({
      title: schema(string(), streaming()),
      tags: schema(array(schema(string(), streaming())), streaming()),
    }),
    streaming(),
  );

  expectTypeOf<InferOutput<typeof props>>().toEqualTypeOf<{
    title: string;
    tags: string[];
  }>();
  expectTypeOf<InferStream<typeof props>>().toMatchTypeOf<{
    title?: string;
    tags?: string[];
  }>();
});

test("infers the output of transforms before the streaming checkpoint", () => {
  const props = schema(
    string(),
    transform((value: string) => value.length),
    streaming(),
  );

  expectTypeOf<InferStream<typeof props>>().toEqualTypeOf<number>();
  expectTypeOf<InferOutput<typeof props>>().toEqualTypeOf<number>();
});

test("separates streaming output from final transforms", () => {
  const props = schema(
    string(),
    streaming(),
    transform((value: string) => value.length),
  );

  expectTypeOf<InferStream<typeof props>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof props>>().toEqualTypeOf<number>();
});

test("infers exact streaming union branches", () => {
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

  expectTypeOf<InferStream<typeof props>>().toEqualTypeOf<
    string | { kind?: "card"; title?: string }
  >();
});

test("type-checks readiness paths", () => {
  type Props = { items: { title: string }[]; subtitle?: string };
  const readiness = { statuses: {} } as StreamReadiness<Props>;

  getStreamStatus(readiness, ["items", 0, "title"]);
  getStreamStatus(readiness, ["subtitle"]);
  // @ts-expect-error unknown readiness key
  getStreamStatus(readiness, ["missing"]);
  // @ts-expect-error array paths require an index
  getStreamStatus(readiness, ["items", "title"]);
});

test("rejects unsupported and duplicate streaming checkpoints", () => {
  // @ts-expect-error numbers have no partial streaming semantics
  schema(number(), streaming());
  // @ts-expect-error async numbers have no partial streaming semantics
  schemaAsync(number(), streaming());
  // @ts-expect-error one local streaming checkpoint is allowed
  schema(string(), streaming(), streaming());
  // @ts-expect-error one local streaming checkpoint is allowed
  schemaAsync(string(), streaming(), streaming());
});

test("rejects an async action before a streaming checkpoint", () => {
  const asyncTransform = transformAsync(async (value: string) => value.length);

  // @ts-expect-error async actions cannot run before a streaming checkpoint
  schemaAsync(string(), asyncTransform, streaming());
});
