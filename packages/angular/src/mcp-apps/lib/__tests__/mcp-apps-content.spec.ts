import { expect, it } from "vitest";
import { mcpAppsSnapshotContentSchema } from "../mcp-apps-content";

const validContent = {
  serverHash: "server-hash",
  serverId: "demo",
  resourceUri: "ui://demo/widget.html",
  result: { content: [{ type: "text", text: "done" }] },
  toolInput: { city: "Paris" },
};

it("accepts the established middleware snapshot contract", () => {
  const parsed = mcpAppsSnapshotContentSchema.safeParse(validContent);

  expect(parsed.success).toBe(true);
});

it("accepts a snapshot without an optional stable server id", () => {
  const { serverId: _serverId, ...withoutServerId } = validContent;

  expect(mcpAppsSnapshotContentSchema.safeParse(withoutServerId).success).toBe(
    true,
  );
});

it.each([
  { type: "text", text: "done" },
  { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" },
  {
    type: "resource",
    resource: { uri: "ui://demo/readme", text: "hello" },
  },
  {
    type: "resource",
    resource: {
      uri: "ui://demo/data",
      blob: "YmluYXJ5",
      mimeType: "application/octet-stream",
    },
  },
  {
    type: "resource_link",
    uri: "ui://demo/readme",
    name: "Read me",
  },
])("accepts MCP tool-result content variant $type", (content) => {
  expect(
    mcpAppsSnapshotContentSchema.safeParse({
      ...validContent,
      result: { content: [content] },
    }).success,
  ).toBe(true);
});

it("applies the MCP empty-content default", () => {
  const parsed = mcpAppsSnapshotContentSchema.parse({
    ...validContent,
    result: { structuredContent: { temperature: 21 } },
  });

  expect(parsed.result.content).toEqual([]);
});

it("keeps unknown keys so future snapshot fields survive parsing", () => {
  const parsed = mcpAppsSnapshotContentSchema.safeParse({
    ...validContent,
    sessionId: "s-1",
  });

  expect(parsed.success).toBe(true);
  expect((parsed as { data: Record<string, unknown> }).data.sessionId).toBe(
    "s-1",
  );
});

it("rejects a snapshot without the middleware server hash", () => {
  const { serverHash: _serverHash, ...rest } = validContent;

  expect(mcpAppsSnapshotContentSchema.safeParse(rest).success).toBe(false);
});

it("rejects a snapshot with an invalid tool result", () => {
  const parsed = mcpAppsSnapshotContentSchema.safeParse({
    ...validContent,
    result: { content: "not an array" },
  });

  expect(parsed.success).toBe(false);
});

it.each([
  { type: "image", data: "not base64!", mimeType: "image/png" },
  { type: "audio", data: "abc", mimeType: "audio/wav" },
  { type: "resource", resource: { uri: "ui://demo/empty" } },
  { type: "resource_link", uri: "ui://demo/missing-name" },
  { type: "unknown", value: "future" },
])("rejects malformed MCP tool-result content variant $type", (content) => {
  expect(
    mcpAppsSnapshotContentSchema.safeParse({
      ...validContent,
      result: { content: [content] },
    }).success,
  ).toBe(false);
});
