import { ArkErrors, type as arkType } from "arktype";
import * as v from "valibot";
import { expect, test } from "vitest";
import * as z from "zod/v4";

import {
  array,
  boolean,
  check,
  coerceNumber,
  date,
  email,
  intersect,
  lazy,
  literal,
  looseObject,
  minLength,
  nullish,
  number,
  object,
  optional,
  parse,
  parseAsync,
  partial,
  pick,
  record,
  safeParse,
  schema,
  schemaAsync,
  strictObject,
  string,
  toLowerCase,
  transformAsync,
  trim,
  tupleWithRest,
  union,
  variant,
} from "./index.js";
import type { Schema } from "./index.js";

type LibraryName = "@copilotkit/schema" | "arktype" | "valibot" | "zod";
type LibraryOutputs = Readonly<Record<LibraryName, unknown>>;

/**
 * Assert that every library returns the same output and label failures by library.
 */
function expectEveryOutput(outputs: LibraryOutputs, expected: unknown): void {
  for (const [library, output] of Object.entries(outputs)) {
    expect(output, library).toEqual(expected);
  }
}

test("primitive validation produces the same scalar outputs in every library", () => {
  const input = { active: true, age: 37, name: "Ada" };

  const outputs = {
    "@copilotkit/schema": parse(
      object({ active: boolean(), age: number(), name: string() }),
      input,
    ),
    arktype: arkType({
      active: "boolean",
      age: "number",
      name: "string",
    }).assert(input),
    valibot: v.parse(
      v.object({
        active: v.boolean(),
        age: v.number(),
        name: v.string(),
      }),
      input,
    ),
    zod: z
      .object({ active: z.boolean(), age: z.number(), name: z.string() })
      .parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("nested objects, arrays, and optional fields produce the same output", () => {
  const input = {
    profile: {
      name: "Ada",
      tags: ["math", "code"],
    },
  };

  const outputs = {
    "@copilotkit/schema": parse(
      object({
        profile: object({
          name: string(),
          nickname: optional(string()),
          tags: array(string()),
        }),
      }),
      input,
    ),
    arktype: arkType({
      profile: {
        name: "string",
        "nickname?": "string",
        tags: "string[]",
      },
    }).assert(input),
    valibot: v.parse(
      v.object({
        profile: v.object({
          name: v.string(),
          nickname: v.optional(v.string()),
          tags: v.array(v.string()),
        }),
      }),
      input,
    ),
    zod: z
      .object({
        profile: z.object({
          name: z.string(),
          nickname: z.string().optional(),
          tags: z.array(z.string()),
        }),
      })
      .parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("object defaults fill missing fields in every library", () => {
  const input = {};
  const expected = { role: "user" };

  const outputs = {
    "@copilotkit/schema": parse(
      object({ role: optional(string(), "user") }),
      input,
    ),
    arktype: arkType({ role: ["string", "=", "user"] }).assert(input),
    valibot: v.parse(v.object({ role: v.optional(v.string(), "user") }), input),
    zod: z.object({ role: z.string().default("user") }).parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, expected);
});

test("nullish schemas accept strings, null, and undefined in every library", () => {
  const inputs = ["Ada", null, undefined] as const;
  const schema_ = nullish(string());
  const arktypeSchema = arkType("string | null | undefined");
  const valibotSchema = v.nullish(v.string());
  const zodSchema = z.string().nullish();

  for (const input of inputs) {
    const outputs = {
      "@copilotkit/schema": parse(schema_, input),
      arktype: arktypeSchema.assert(input),
      valibot: v.parse(valibotSchema, input),
      zod: zodSchema.parse(input),
    } satisfies LibraryOutputs;

    expectEveryOutput(outputs, input);
  }
});

test("ordered string checks and transforms produce the same normalized value", () => {
  const input = "  ADA  ";
  const expected = "ada";

  const outputs = {
    "@copilotkit/schema": parse(
      schema(string(), trim(), minLength(3), toLowerCase()),
      input,
    ),
    arktype: arkType("string")
      .pipe((value) => value.trim())
      .narrow((value) => value.length >= 3)
      .pipe((value) => value.toLowerCase())
      .assert(input),
    valibot: v.parse(
      v.pipe(v.string(), v.trim(), v.minLength(3), v.toLowerCase()),
      input,
    ),
    zod: z.string().trim().min(3).toLowerCase().parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, expected);
});

test("custom refinements reject the same invalid value in every library", () => {
  const input = 3;
  const isEven = (value: number): boolean => value % 2 === 0;

  const accepted = {
    "@copilotkit/schema": safeParse(
      schema(number(), check(isEven, "Expected an even number")),
      input,
    ).success,
    arktype: arkType("number").narrow(isEven).allows(input),
    valibot: v.safeParse(
      v.pipe(v.number(), v.check(isEven, "Expected an even number")),
      input,
    ).success,
    zod: z.number().refine(isEven, "Expected an even number").safeParse(input)
      .success,
  } satisfies Readonly<Record<LibraryName, boolean>>;

  expect(accepted).toEqual({
    "@copilotkit/schema": false,
    arktype: false,
    valibot: false,
    zod: false,
  });
});

test("unions preserve literal and scalar branches in every library", () => {
  const inputs = ["ready", 42] as const;
  const schema_ = union([literal("ready"), number()]);
  const arktypeSchema = arkType("'ready' | number");
  const valibotSchema = v.union([v.literal("ready"), v.number()]);
  const zodSchema = z.union([z.literal("ready"), z.number()]);

  for (const input of inputs) {
    const outputs = {
      "@copilotkit/schema": parse(schema_, input),
      arktype: arktypeSchema.assert(input),
      valibot: v.parse(valibotSchema, input),
      zod: zodSchema.parse(input),
    } satisfies LibraryOutputs;

    expectEveryOutput(outputs, input);
  }
});

test("discriminated unions select and preserve the same object branch", () => {
  const input = { kind: "cat", lives: 9 };
  const schema_ = variant("kind", [
    object({ kind: literal("cat"), lives: number() }),
    object({ good: boolean(), kind: literal("dog") }),
  ]);
  const arktypeSchema = arkType({
    kind: "'cat'",
    lives: "number",
  }).or({
    good: "boolean",
    kind: "'dog'",
  });
  const valibotSchema = v.variant("kind", [
    v.object({ kind: v.literal("cat"), lives: v.number() }),
    v.object({ good: v.boolean(), kind: v.literal("dog") }),
  ]);
  const zodSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cat"), lives: z.number() }),
    z.object({ good: z.boolean(), kind: z.literal("dog") }),
  ]);

  const outputs = {
    "@copilotkit/schema": parse(schema_, input),
    arktype: arktypeSchema.assert(input),
    valibot: v.parse(valibotSchema, input),
    zod: zodSchema.parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("object intersections merge compatible fields in every library", () => {
  const input = { active: true, id: "user-1" };

  const outputs = {
    "@copilotkit/schema": parse(
      intersect([object({ id: string() }), object({ active: boolean() })]),
      input,
    ),
    arktype: arkType({ id: "string" }).and({ active: "boolean" }).assert(input),
    valibot: v.parse(
      v.intersect([
        v.object({ id: v.string() }),
        v.object({ active: v.boolean() }),
      ]),
      input,
    ),
    zod: z
      .intersection(
        z.object({ id: z.string() }),
        z.object({ active: z.boolean() }),
      )
      .parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("plain object schemas strip unknown keys in every library", () => {
  const input = { extra: true, id: "user-1" };
  const expected = { id: "user-1" };

  const outputs = {
    "@copilotkit/schema": parse(object({ id: string() }), input),
    arktype: arkType({ id: "string" }).onUndeclaredKey("delete").assert(input),
    valibot: v.parse(v.object({ id: v.string() }), input),
    zod: z.object({ id: z.string() }).parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, expected);
});

test("strict object schemas reject unknown keys in every library", () => {
  const input = { extra: true, id: "user-1" };

  const accepted = {
    "@copilotkit/schema": safeParse(strictObject({ id: string() }), input)
      .success,
    arktype: arkType({ id: "string" }).onUndeclaredKey("reject").allows(input),
    valibot: v.safeParse(v.strictObject({ id: v.string() }), input).success,
    zod: z.strictObject({ id: z.string() }).safeParse(input).success,
  } satisfies Readonly<Record<LibraryName, boolean>>;

  expect(accepted).toEqual({
    "@copilotkit/schema": false,
    arktype: false,
    valibot: false,
    zod: false,
  });
});

test("loose object schemas preserve unknown keys in every library", () => {
  const input = { extra: true, id: "user-1" };

  const outputs = {
    "@copilotkit/schema": parse(looseObject({ id: string() }), input),
    arktype: arkType({ id: "string" }).assert(input),
    valibot: v.parse(v.looseObject({ id: v.string() }), input),
    zod: z.looseObject({ id: z.string() }).parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("tuples with rest elements preserve every position in every library", () => {
  const input = ["Ada", 37, true, false] as const;

  const outputs = {
    "@copilotkit/schema": parse(
      tupleWithRest([string(), number()], boolean()),
      input,
    ),
    arktype: arkType(["string", "number", "...", "boolean[]"]).assert(input),
    valibot: v.parse(
      v.tupleWithRest([v.string(), v.number()], v.boolean()),
      input,
    ),
    zod: z.tuple([z.string(), z.number()], z.boolean()).parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("string-keyed records validate the same key-value map in every library", () => {
  const input = { one: 1, two: 2 };

  const outputs = {
    "@copilotkit/schema": parse(record(string(), number()), input),
    arktype: arkType({ "[string]": "number" }).assert(input),
    valibot: v.parse(v.record(v.string(), v.number()), input),
    zod: z.record(z.string(), z.number()).parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("recursive object schemas validate the same tree in every library", () => {
  interface TreeNode {
    readonly children: TreeNode[];
    readonly value: string;
  }

  const input: TreeNode = {
    children: [{ children: [], value: "leaf" }],
    value: "root",
  };
  const schema_: Schema<TreeNode> = lazy(() =>
    object({ children: array(schema_), value: string() }),
  );
  const arktypeSchema = arkType.module({
    node: { children: "node[]", value: "string" },
  }).node;
  const valibotSchema: v.GenericSchema<TreeNode> = v.lazy(() =>
    v.object({ children: v.array(valibotSchema), value: v.string() }),
  );
  const zodSchema: z.ZodType<TreeNode> = z.lazy(() =>
    z.object({ children: z.array(zodSchema), value: z.string() }),
  );

  const outputs = {
    "@copilotkit/schema": parse(schema_, input),
    arktype: arktypeSchema.assert(input),
    valibot: v.parse(valibotSchema, input),
    zod: zodSchema.parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, input);
});

test("numeric coercion produces the same parsed number in every library", () => {
  const input = "42";
  const expected = 42;

  const outputs = {
    "@copilotkit/schema": parse(coerceNumber(), input),
    arktype: arkType("string.numeric.parse").assert(input),
    valibot: v.parse(
      v.pipe(
        v.string(),
        v.transform(Number),
        v.check((value: number) => Number.isFinite(value)),
      ),
      input,
    ),
    zod: z.coerce.number().parse(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, expected);
});

test("date and email schemas accept the same built-in values", () => {
  const dateInput = new Date("2026-07-27T00:00:00.000Z");
  const emailInput = "ada@example.com";

  const dateOutputs = {
    "@copilotkit/schema": parse(date(), dateInput),
    arktype: arkType("Date").assert(dateInput),
    valibot: v.parse(v.date(), dateInput),
    zod: z.date().parse(dateInput),
  } satisfies LibraryOutputs;
  const emailOutputs = {
    "@copilotkit/schema": parse(schema(string(), email()), emailInput),
    arktype: arkType("string.email").assert(emailInput),
    valibot: v.parse(v.pipe(v.string(), v.email()), emailInput),
    zod: z.string().email().parse(emailInput),
  } satisfies LibraryOutputs;

  expectEveryOutput(dateOutputs, dateInput);
  expectEveryOutput(emailOutputs, emailInput);
});

test("object pick and partial utilities derive the same output contracts", () => {
  const input = { age: 37, id: "user-1" };
  const expectedPick = { id: "user-1" };
  const schemaObject = object({ age: number(), id: string() });
  const arktypeObject = arkType({ age: "number", id: "string" });
  const valibotObject = v.object({ age: v.number(), id: v.string() });
  const zodObject = z.object({ age: z.number(), id: z.string() });

  const picked = {
    "@copilotkit/schema": parse(pick(schemaObject, ["id"]), input),
    arktype: arktypeObject.pick("id").onUndeclaredKey("delete").assert(input),
    valibot: v.parse(v.pick(valibotObject, ["id"]), input),
    zod: zodObject.pick({ id: true }).parse(input),
  } satisfies LibraryOutputs;
  const partialOutputs = {
    "@copilotkit/schema": parse(partial(schemaObject), {}),
    arktype: arktypeObject.partial().assert({}),
    valibot: v.parse(v.partial(valibotObject), {}),
    zod: zodObject.partial().parse({}),
  } satisfies LibraryOutputs;

  expectEveryOutput(picked, expectedPick);
  expectEveryOutput(partialOutputs, {});
});

test("nested error paths identify the same failing array item", () => {
  const input = { profile: { tags: ["math", 42] } };
  const schemaResult = safeParse(
    object({ profile: object({ tags: array(string()) }) }),
    input,
  );
  const arktypeResult = arkType({
    profile: { tags: "string[]" },
  })(input);
  const valibotResult = v.safeParse(
    v.object({ profile: v.object({ tags: v.array(v.string()) }) }),
    input,
  );
  const zodResult = z
    .object({ profile: z.object({ tags: z.array(z.string()) }) })
    .safeParse(input);

  const paths = {
    "@copilotkit/schema": schemaResult.success
      ? []
      : schemaResult.issues.map((issue) => issue.path.join(".")),
    arktype:
      arktypeResult instanceof ArkErrors
        ? arktypeResult.map((error) => error.path.join("."))
        : [],
    valibot: valibotResult.success
      ? []
      : valibotResult.issues.map(
          (issue) =>
            issue.path?.map((item) => String(item.key)).join(".") ?? "",
        ),
    zod: zodResult.success
      ? []
      : zodResult.error.issues.map((issue) => issue.path.join(".")),
  } satisfies LibraryOutputs;

  expectEveryOutput(paths, ["profile.tags.1"]);
});

test("async transforms return the same awaited output in every library", async () => {
  const input = "Ada";
  const expected = 3;
  const schema_ = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const arktypeSchema = arkType("string").pipe(async (value) => value.length);
  const valibotSchema = v.pipeAsync(
    v.string(),
    v.transformAsync(async (value) => value.length),
  );
  const zodSchema = z.string().transform(async (value) => value.length);

  const outputs = {
    "@copilotkit/schema": await parseAsync(schema_, input),
    arktype: await arktypeSchema.assert(input),
    valibot: await v.parseAsync(valibotSchema, input),
    zod: await zodSchema.parseAsync(input),
  } satisfies LibraryOutputs;

  expectEveryOutput(outputs, expected);
});

test("Standard Schema v1 validates the same schema through every library", async () => {
  const input = { id: "user-1" };
  const schemas = {
    "@copilotkit/schema": object({ id: string() }),
    arktype: arkType({ id: "string" }),
    valibot: v.object({ id: v.string() }),
    zod: z.object({ id: z.string() }),
  } as const;
  const entries = await Promise.all(
    Object.entries(schemas).map(async ([library, schema_]) => {
      const result = await schema_["~standard"].validate(input);
      return [
        library,
        "value" in result ? result.value : result.issues,
      ] as const;
    }),
  );
  const outputs = Object.fromEntries(entries) as LibraryOutputs;

  expectEveryOutput(outputs, input);
  expect(
    Object.fromEntries(
      Object.entries(schemas).map(([library, schema_]) => [
        library,
        schema_["~standard"].version,
      ]),
    ),
  ).toEqual({
    "@copilotkit/schema": 1,
    arktype: 1,
    valibot: 1,
    zod: 1,
  });
});
