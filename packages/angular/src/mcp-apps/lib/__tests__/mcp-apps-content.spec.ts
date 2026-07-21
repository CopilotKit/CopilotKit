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
