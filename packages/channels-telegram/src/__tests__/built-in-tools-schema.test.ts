/**
 * The `lookup_telegram_user` parameter schema used to be a Zod object. It is
 * now built by `singleStringParameterSchema` from `@copilotkit/channels-core`,
 * so that `@copilotkit/channels-telegram` declares no `zod` dependency
 * (PE-30).
 *
 * These tests pin the two things the agent actually depends on, and they go
 * through the real `channels-core` entry points rather than poking at
 * `~standard` directly:
 *
 *   - `toAgentToolDescriptors` — the JSON Schema the model is shown.
 *   - `parseToolArgs` — the validation a tool call is put through.
 *
 * They were written against the Zod implementation and passed unchanged after
 * the migration, which is what makes them evidence that the descriptor did
 * not move.
 */
import { describe, it, expect } from "vitest";
import {
  toAgentToolDescriptors,
  parseToolArgs,
} from "@copilotkit/channels-core";
import { lookupTelegramUserTool } from "../built-in-tools.js";

describe("lookup_telegram_user parameter schema", () => {
  it("emits the same JSON Schema the Zod object emitted", () => {
    const [descriptor] = toAgentToolDescriptors([lookupTelegramUserTool]);

    expect(descriptor).toBeDefined();
    expect(descriptor?.name).toBe("lookup_telegram_user");
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
            "Handle, display name, or first name of the person to look up.",
        },
      },
      required: ["query"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    });
  });

  it("accepts a valid query", async () => {
    const r = await parseToolArgs(lookupTelegramUserTool.parameters, {
      query: "ada",
    });
    expect(r).toEqual({ ok: true, value: { query: "ada" } });
  });

  it("strips unknown keys instead of rejecting them, as z.object did", async () => {
    const r = await parseToolArgs(lookupTelegramUserTool.parameters, {
      query: "ada",
      extra: "ignored",
    });
    expect(r).toEqual({ ok: true, value: { query: "ada" } });
  });

  it("rejects a missing query, naming the field in the error", async () => {
    const r = await parseToolArgs(lookupTelegramUserTool.parameters, {});
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("query");
  });

  it("rejects a non-string query", async () => {
    const r = await parseToolArgs(lookupTelegramUserTool.parameters, {
      query: 42,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("query");
  });

  it("rejects an empty query, which is what .min(1) guarded", async () => {
    const r = await parseToolArgs(lookupTelegramUserTool.parameters, {
      query: "",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object argument payload", async () => {
    const r = await parseToolArgs(lookupTelegramUserTool.parameters, null);
    expect(r.ok).toBe(false);
  });
});
