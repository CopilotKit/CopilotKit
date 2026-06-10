import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  toAgentToolDescriptors,
  parseToolArgs,
  type FrontendTool,
} from "../frontend-tools.js";
import type { StandardSchemaV1 } from "../standard-schema.js";

describe("toAgentToolDescriptors", () => {
  it("converts a tool's Zod schema into JSON Schema for the agent", () => {
    const tool: FrontendTool = {
      name: "echo",
      description: "echo the input",
      parameters: z.object({
        message: z.string().describe("the message to echo"),
        upper: z.boolean().optional(),
      }),
      handler: async ({ message }) => message,
    };
    const [descriptor] = toAgentToolDescriptors([tool]);
    expect(descriptor?.name).toBe("echo");
    expect(descriptor?.description).toBe("echo the input");
    const params = descriptor?.parameters as Record<string, unknown>;
    expect(params?.type).toBe("object");
    // Zod descriptions flow through to JSON Schema descriptions.
    const props = params?.properties as Record<
      string,
      { description?: string }
    >;
    expect(props.message?.description).toBe("the message to echo");
    expect(params?.required).toEqual(["message"]);
  });

  it("inlines refs (no $ref soup) so picky LLM tool APIs don't choke", () => {
    const Address = z.object({ street: z.string(), city: z.string() });
    const tool: FrontendTool = {
      name: "ship",
      description: "ship to address",
      parameters: z.object({ from: Address, to: Address }),
      handler: async () => "",
    };
    const [descriptor] = toAgentToolDescriptors([tool]);
    const json = JSON.stringify(descriptor?.parameters);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$defs");
  });
});

describe("parseToolArgs", () => {
  const schema = z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
  });

  it("returns ok with typed value on a valid input", async () => {
    const r = await parseToolArgs(schema, { query: "atai", limit: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.query).toBe("atai");
      expect(r.value.limit).toBe(5);
    }
  });

  it("returns a human-readable error on a missing required field", async () => {
    const r = await parseToolArgs(schema, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("query");
  });

  it("returns a human-readable error on wrong-typed field", async () => {
    const r = await parseToolArgs(schema, { query: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("string");
  });

  it("rejects empty string when schema requires min(1)", async () => {
    const r = await parseToolArgs(schema, { query: "" });
    expect(r.ok).toBe(false);
  });
});

describe("schema-library-agnostic (non-Zod Standard Schema)", () => {
  // A dependency-free Standard Schema implementation. Proves the SDK's
  // public API accepts ANY Standard Schema validator (Valibot, ArkType,
  // a hand-rolled one) — not just Zod. Implements the native Standard
  // JSON Schema protocol, so `toJsonSchema` never touches the Zod
  // fallback.
  const nameSchema = {
    "~standard": {
      version: 1 as const,
      vendor: "test-suite",
      validate(value: unknown) {
        if (
          typeof value === "object" &&
          value !== null &&
          typeof (value as Record<string, unknown>)["name"] === "string"
        ) {
          return { value: value as { name: string } };
        }
        return {
          issues: [{ message: "name must be a string", path: ["name"] }],
        };
      },
      jsonSchema: {
        input: () => ({
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        }),
        output: () => ({
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        }),
      },
    },
  } as unknown as StandardSchemaV1<{ name: string }, { name: string }>;

  it("validates tool args through a non-Zod schema", async () => {
    const ok = await parseToolArgs(nameSchema, { name: "ada" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.name).toBe("ada");

    const bad = await parseToolArgs(nameSchema, { name: 42 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("name");
  });

  it("emits JSON Schema from a non-Zod schema via the native protocol", () => {
    const tool: FrontendTool = {
      name: "greet",
      description: "greet someone",
      parameters: nameSchema,
      handler: async ({ name }) => `hi ${name}`,
    };
    const [descriptor] = toAgentToolDescriptors([tool]);
    const params = descriptor?.parameters as Record<string, unknown>;
    expect(params?.type).toBe("object");
    expect(params?.required).toEqual(["name"]);
  });

  it("awaits a Promise-returning Standard Schema validator (async validate)", async () => {
    // A validator whose `~standard.validate` returns a Promise. Guards the
    // refactor's raison d'être: validation must be awaited, not returned
    // as a pending thenable.
    const asyncSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "test-async",
        validate: (value: unknown) =>
          Promise.resolve(
            typeof (value as Record<string, unknown>)?.["name"] === "string"
              ? { value: value as { name: string } }
              : {
                  issues: [
                    { message: "name must be a string", path: ["name"] },
                  ],
                },
          ),
      },
    } as unknown as StandardSchemaV1<{ name: string }, { name: string }>;

    const ok = await parseToolArgs(asyncSchema, { name: "ada" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.name).toBe("ada");

    const bad = await parseToolArgs(asyncSchema, { name: 42 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("name");
  });
});
