/**
 * `singleStringParameterSchema` replaces the `z.object({query: z.string()
 * .min(1).describe(...)})` that every platform adapter used to build its
 * `lookup_<platform>_user` parameter with, so that no adapter declares a
 * `zod` range (PE-30).
 *
 * The contract it has to honor is "behaves like the Zod object it replaces",
 * so these tests assert against Zod itself rather than against a transcribed
 * expectation. `zod` is a devDependency of this package; nothing published
 * imports it.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { singleStringParameterSchema } from "./standard-schema.js";
import { toJsonSchema, validateSchema } from "./standard-schema.js";

const DESCRIPTION = "Handle, display name, or first name of the person.";

const schema = singleStringParameterSchema({
  name: "query",
  description: DESCRIPTION,
  vendor: "@copilotkit/channels-core",
});

/** The exact Zod object this helper is a drop-in replacement for. */
const zodEquivalent = z.object({
  query: z.string().min(1).describe(DESCRIPTION),
});

describe("singleStringParameterSchema", () => {
  it("emits the JSON Schema document the Zod object emits", () => {
    expect(toJsonSchema(schema)).toEqual(
      zodToJsonSchema(zodEquivalent, { $refStrategy: "none" }),
    );
  });

  it("names the field the caller asked for", () => {
    const renamed = singleStringParameterSchema({
      name: "handle",
      description: DESCRIPTION,
      vendor: "test",
    });
    const doc = toJsonSchema(renamed) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(doc.properties)).toEqual(["handle"]);
    expect(doc.required).toEqual(["handle"]);
  });

  it("reports the declared vendor, not zod", () => {
    // `schemaToJsonSchema` routes a `vendor: "zod"` schema through
    // `zod-to-json-schema`. Anything else must carry its own document.
    expect(schema["~standard"].vendor).toBe("@copilotkit/channels-core");
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
   * is part of the contract, not an implementation detail. Asserting only
   * "both reject" let a real divergence through: a missing field reported
   * "Expected string, received undefined" where Zod reports "Required".
   * Compare the rendered text, formatted the same way `validateSchema` does.
   */
  it.each([
    ["a missing field", {}],
    ["a number field", { query: 42 }],
    ["a null field", { query: null }],
    ["an array field", { query: [] }],
    ["a boolean field", { query: true }],
    ["an object field", { query: {} }],
    ["an explicit undefined field", { query: undefined }],
    ["an empty string", { query: "" }],
    ["null as the payload", null],
    ["an array as the payload", []],
    ["a string as the payload", "ada"],
    ["a number as the payload", 7],
  ])("renders the same error text as zod for %s", async (_label, value) => {
    const mine = await validateSchema(schema, value);
    const theirs = zodEquivalent.safeParse(value);

    expect(mine.ok).toBe(theirs.success);
    expect(theirs.success).toBe(false);

    const zodText = theirs.success
      ? null
      : theirs.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
    expect(mine.ok === false && mine.error).toBe(zodText);
  });

  /**
   * `zodToJsonSchema` built a fresh document on every call and
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
