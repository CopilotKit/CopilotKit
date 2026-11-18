/**
 * `singleStringParameterSchema` replaces the `z.object({query: z.string()
 * .min(1).describe(...)})` that every platform adapter used to build its
 * `lookup_<platform>_user` parameter with, so that no adapter declares a
 * `zod` range (PE-30).
 *
 * The contract it has to honor is "behaves like the Zod 3 object it
 * replaces". Accept/reject decisions are still checked against Zod itself.
 * The JSON Schema document and the error text are transcribed from what Zod 3
 * and `zod-to-json-schema` produced, because the workspace now runs Zod 4,
 * which words both differently, and the agent must keep seeing the same text.
 * `zod` is a devDependency of this package; nothing published imports it.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { singleStringParameterSchema } from "./standard-schema.js";
import type { InferSchemaOutput } from "./standard-schema.js";
import { toJsonSchema, validateSchema } from "./standard-schema.js";

const DESCRIPTION = "Handle, display name, or first name of the person.";

const schema = singleStringParameterSchema({
  name: "query",
  description: DESCRIPTION,
});

/** The exact Zod object this helper is a drop-in replacement for. */
const zodEquivalent = z.object({
  query: z.string().min(1).describe(DESCRIPTION),
});

describe("singleStringParameterSchema", () => {
  it("emits the JSON Schema document zod-to-json-schema emitted for the Zod 3 object", () => {
    expect(toJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: DESCRIPTION },
      },
      required: ["query"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    });
  });

  it("names the field the caller asked for", () => {
    const renamed = singleStringParameterSchema({
      name: "handle",
      description: DESCRIPTION,
    });
    const doc = toJsonSchema(renamed) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(doc.properties)).toEqual(["handle"]);
    expect(doc.required).toEqual(["handle"]);
  });

  it("names this package as the vendor, not zod and not the caller", () => {
    // The Standard Schema `vendor` names the library that produced the
    // schema, which is `channels-core` whichever adapter calls the helper.
    // It carries its own document in `~standard.jsonSchema`, so the vendor
    // tag says nothing about how it converts.
    expect(schema["~standard"].vendor).toBe("@copilotkit/channels-core");
    const renamed = singleStringParameterSchema({
      name: "handle",
      description: DESCRIPTION,
    });
    expect(renamed["~standard"].vendor).toBe("@copilotkit/channels-core");
  });

  it("accepts a valid value, exactly as the Zod object does", async () => {
    expect(await validateSchema(schema, { query: "ada" })).toEqual({
      ok: true,
      value: { query: "ada" },
    });
    expect(zodEquivalent.safeParse({ query: "ada" }).data).toEqual({
      query: "ada",
    });
  });

  it("strips unknown keys rather than rejecting them, as z.object does", async () => {
    const input = { query: "ada", extra: "ignored" };
    expect(await validateSchema(schema, input)).toEqual({
      ok: true,
      value: { query: "ada" },
    });
    // Pin the Zod behavior this mirrors, so a Zod default change is visible.
    expect(zodEquivalent.safeParse(input).data).toEqual({ query: "ada" });
  });

  it("rejects a missing field and names it", async () => {
    const r = await validateSchema(schema, {});
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("query");
    expect(zodEquivalent.safeParse({}).success).toBe(false);
  });

  it("rejects an empty string, which is what .min(1) guarded", async () => {
    const r = await validateSchema(schema, { query: "" });
    expect(r.ok).toBe(false);
    expect(zodEquivalent.safeParse({ query: "" }).success).toBe(false);
  });

  it.each([
    ["a number", 42, "number"],
    ["null", null, "null"],
    ["an array", [], "array"],
  ])(
    "rejects %s field, naming the received type",
    async (_label, value, received) => {
      const r = await validateSchema(schema, { query: value });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain(received);
    },
  );

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "ada"],
  ])("rejects %s as the whole argument payload", async (_label, value) => {
    const r = await validateSchema(schema, value);
    expect(r.ok).toBe(false);
    expect(zodEquivalent.safeParse(value).success).toBe(false);
  });

  /**
   * The error string is what the agent reads back on a bad tool call, so it
   * is part of the contract, not an implementation detail. The expected text
   * is what Zod 3 rendered for the object this helper replaced, formatted the
   * way `validateSchema` does.
   */
  it.each([
    ["a missing field", {}, "query: Required"],
    [
      "a number field",
      { query: 42 },
      "query: Expected string, received number",
    ],
    ["a null field", { query: null }, "query: Expected string, received null"],
    ["an array field", { query: [] }, "query: Expected string, received array"],
    [
      "a boolean field",
      { query: true },
      "query: Expected string, received boolean",
    ],
    [
      "an object field",
      { query: {} },
      "query: Expected string, received object",
    ],
    ["an explicit undefined field", { query: undefined }, "query: Required"],
    [
      "an empty string",
      { query: "" },
      "query: String must contain at least 1 character(s)",
    ],
    ["null as the payload", null, "(root): Expected object, received null"],
    ["an array as the payload", [], "(root): Expected object, received array"],
    [
      "a string as the payload",
      "ada",
      "(root): Expected object, received string",
    ],
    ["a number as the payload", 7, "(root): Expected object, received number"],
  ])("renders the Zod 3 error text for %s", async (_label, value, expected) => {
    const mine = await validateSchema(schema, value);

    expect(mine).toEqual({ ok: false, error: expected });
    expect(zodEquivalent.safeParse(value).success).toBe(false);
  });

  /**
   * `zod-to-json-schema` built a fresh document on every call and
   * `toAgentToolDescriptors` hands its result straight to the caller, so a
   * consumer that normalizes the schema in place (dropping `$schema` for a
   * provider that rejects it, for instance) must not corrupt later turns.
   */
  it("returns a fresh JSON Schema document on every call", () => {
    const first = toJsonSchema(schema) as {
      properties: { query: { description: string } };
    };
    const second = toJsonSchema(schema);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    first.properties.query.description = "mutated by a consumer";
    const third = toJsonSchema(schema) as {
      properties: { query: { description: string } };
    };
    expect(third.properties.query.description).toBe(DESCRIPTION);
  });
});

/**
 * Type-level assertions. `check-types` runs `tsconfig.check.json`, which
 * includes this file, so a `@ts-expect-error` here fails the build when the
 * error it expects stops happening. Nothing below runs.
 *
 * The output type is built by mapping over `Name`. A union of names would
 * claim every member is a present `string` while the function creates exactly
 * one key, and a widened `string` would claim every possible key. Both promise
 * a `string` where the value is `undefined`, so both have to be rejected at
 * the call.
 */
describe("type-level contract", () => {
  it("is enforced by check-types, not at runtime", () => {
    const literal = singleStringParameterSchema({
      name: "query",
      description: DESCRIPTION,
    });
    type Out = InferSchemaOutput<typeof literal>;
    // The literal key is inferred, and nothing else exists on the output.
    const ok: Out = { query: "ada" };
    // @ts-expect-error `nope` is not a key of the inferred output
    const bogus: Out = { query: "ada", nope: 1 };

    const unionName = (Math.random() > 0.5 ? "query" : "handle") as
      | "query"
      | "handle";
    singleStringParameterSchema({
      // @ts-expect-error a union of names would promise a key that is never created
      name: unionName,
      description: DESCRIPTION,
    });

    const dynamicName: string = "query";
    singleStringParameterSchema({
      // @ts-expect-error a widened `string` would promise every possible key
      name: dynamicName,
      description: DESCRIPTION,
    });

    expect(ok.query).toBe("ada");
    expect(bogus).toBeDefined();
  });
});
