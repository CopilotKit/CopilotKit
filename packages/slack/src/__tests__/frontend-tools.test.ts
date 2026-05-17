import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  toAgentToolDescriptors,
  parseToolArgs,
  type FrontendTool,
} from "../frontend-tools.js";

describe("toAgentToolDescriptors", () => {
  it("converts a tool's Zod schema into JSON Schema for the agent", () => {
    const tool: FrontendTool = {
      name: "echo",
      description: "echo the input",
      parameters: z.object({
        message: z.string().describe("the message to echo"),
        upper: z.boolean().optional(),
      }),
      execute: async ({ message }) => message,
    };
    const [descriptor] = toAgentToolDescriptors([tool]);
    expect(descriptor?.name).toBe("echo");
    expect(descriptor?.description).toBe("echo the input");
    const params = descriptor?.parameters as Record<string, unknown>;
    expect(params?.type).toBe("object");
    // Zod descriptions flow through to JSON Schema descriptions.
    const props = params?.properties as Record<string, { description?: string }>;
    expect(props.message?.description).toBe("the message to echo");
    expect(params?.required).toEqual(["message"]);
  });

  it("inlines refs (no $ref soup) so picky LLM tool APIs don't choke", () => {
    const Address = z.object({ street: z.string(), city: z.string() });
    const tool: FrontendTool = {
      name: "ship",
      description: "ship to address",
      parameters: z.object({ from: Address, to: Address }),
      execute: async () => "",
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

  it("returns ok with typed value on a valid input", () => {
    const r = parseToolArgs(schema, { query: "atai", limit: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.query).toBe("atai");
      expect(r.value.limit).toBe(5);
    }
  });

  it("returns a human-readable error on a missing required field", () => {
    const r = parseToolArgs(schema, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("query");
  });

  it("returns a human-readable error on wrong-typed field", () => {
    const r = parseToolArgs(schema, { query: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("string");
  });

  it("rejects empty string when schema requires min(1)", () => {
    const r = parseToolArgs(schema, { query: "" });
    expect(r.ok).toBe(false);
  });
});
