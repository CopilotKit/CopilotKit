/**
 * The `lookup_slack_user` parameter schema used to be a Zod object. It is
 * now written directly against the Standard Schema protocol so that
 * `@copilotkit/channels-slack` declares no `zod` dependency (OSS-1173).
 *
 * These tests pin the two things the agent actually depends on, and they go
 * through the real `channels-core` entry points rather than poking at
 * `~standard` directly:
 *
 *   - `toAgentToolDescriptors` — the JSON Schema the model is shown.
 *   - `parseToolArgs` — the validation a tool call is put through.
 */
import { describe, it, expect } from "vitest";
import {
  toAgentToolDescriptors,
  parseToolArgs,
} from "@copilotkit/channels-core";
import { lookupSlackUserTool } from "../built-in-tools.js";

describe("lookup_slack_user parameter schema", () => {
  it("emits the same JSON Schema the Zod object emitted", () => {
    const [descriptor] = toAgentToolDescriptors([lookupSlackUserTool]);

    expect(descriptor).toBeDefined();
    expect(descriptor?.name).toBe("lookup_slack_user");
    // Captured from `zodToJsonSchema(z.object({query: z.string().min(1)
    // .describe(...)}), {$refStrategy: "none"})` against zod 3.25.76 —
    // the exact document this schema replaces.
    expect(descriptor?.parameters).toEqual({
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description:
            "Handle, display name, first name, or email of the person to look up.",
        },
      },
      required: ["query"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    });
  });

  it("accepts a valid query", async () => {
    const r = await parseToolArgs(lookupSlackUserTool.parameters, {
      query: "atai",
    });
    expect(r).toEqual({ ok: true, value: { query: "atai" } });
  });

  it("strips unknown keys instead of rejecting them, as z.object did", async () => {
    const r = await parseToolArgs(lookupSlackUserTool.parameters, {
      query: "atai",
      extra: "ignored",
    });
    expect(r).toEqual({ ok: true, value: { query: "atai" } });
  });

  it("rejects a missing query, naming the field in the error", async () => {
    const r = await parseToolArgs(lookupSlackUserTool.parameters, {});
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("query");
  });

  it("rejects a non-string query", async () => {
    const r = await parseToolArgs(lookupSlackUserTool.parameters, {
      query: 42,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("query");
  });

  it("rejects an empty query, which is what .min(1) guarded", async () => {
    const r = await parseToolArgs(lookupSlackUserTool.parameters, {
      query: "",
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("query");
  });

  // The message text matters: it is what the agent reads back and retries on.
  // `typeof` alone reports "object" for null and arrays, so these pin the same
  // classification `z.object()` produced before this schema was hand-written.
  it.each([
    ["null", null, "null"],
    ["a string", "atai", "string"],
    ["an array", ["atai"], "array"],
    ["a number", 7, "number"],
  ])(
    "rejects %s in place of an arguments object, naming its type",
    async (_label, value, expectedType) => {
      const r = await parseToolArgs(lookupSlackUserTool.parameters, value);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toBe(
        `(root): Expected object, received ${expectedType}`,
      );
    },
  );
});
