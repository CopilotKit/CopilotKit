import { describe, expect, it } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MCPAppsActivityContentSchema } from "../content-schema";

const base = { resourceUri: "ui://test/app", serverHash: "test" };
const blocks = [
  {
    type: "text",
    text: "ok",
    annotations: { audience: ["user"], priority: 0.5 },
    extension: true,
  },
  { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" },
  { type: "resource", resource: { uri: "ui://test/text", text: "hello" } },
  { type: "resource", resource: { uri: "ui://test/blob", blob: "YmluYXJ5" } },
  { type: "resource_link", uri: "ui://test/link", name: "link" },
];
describe("CallToolResult contract", () => {
  it.each(blocks)(
    "preserves a valid $type payload and satisfies the SDK",
    (block) => {
      const input = {
        ...base,
        extension: "snapshot",
        result: {
          content: [block],
          _meta: { privateData: { id: 42 } },
          extra: "result",
        },
      };
      const parsed = MCPAppsActivityContentSchema.parse(input);
      expect(parsed).toEqual(input);
      const result: CallToolResult = parsed.result;
      expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    },
  );
  it.each([
    {},
    { structuredContent: { items: [1] } },
    { isError: true, _meta: { reason: "test" } },
  ])("normalizes an omitted content array: %j", (result) => {
    const input = { ...base, result };
    const parsed = MCPAppsActivityContentSchema.parse(input);
    expect(parsed).toEqual({ ...input, result: { ...result, content: [] } });
    expect(parsed.result.content).toEqual([]);
    expect(CallToolResultSchema.safeParse(parsed.result).success).toBe(true);
  });
  it.each([
    { content: "text" },
    { content: [{ type: "text" }] },
    {
      content: [{ type: "image", data: "not base64!", mimeType: "image/png" }],
    },
    { content: [{ type: "audio", data: "abc", mimeType: "audio/wav" }] },
    { content: [{ type: "resource", resource: { uri: "ui://empty" } }] },
    { content: [{ type: "resource_link", uri: "ui://link" }] },
    { content: [{ type: "unknown" }] },
    { structuredContent: "string" },
    { _meta: [] },
    { content: [{ type: "text", text: "ok", annotations: { priority: 2 } }] },
  ])("rejects a malformed result: %j", (result) => {
    const input = { ...base, result };
    expect(MCPAppsActivityContentSchema.safeParse(input).success).toBe(false);
  });
});
