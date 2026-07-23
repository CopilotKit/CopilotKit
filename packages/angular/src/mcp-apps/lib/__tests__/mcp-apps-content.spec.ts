import { describe, expect, it } from "vitest";
import { mcpAppsSnapshotContentSchema } from "../mcp-apps-content";

const validContent = {
  serverId: "demo",
  resourceUri: "ui://demo/widget.html",
  result: { content: [{ type: "text", text: "done" }] },
  toolInput: { city: "Paris" },
};

describe("mcpAppsSnapshotContentSchema", () => {
  it("accepts a complete mcp-apps snapshot", () => {
    const parsed = mcpAppsSnapshotContentSchema.safeParse(validContent);

    expect(parsed.success).toBe(true);
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

  it("rejects a snapshot without a server id", () => {
    const { serverId, ...rest } = validContent;

    expect(mcpAppsSnapshotContentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a snapshot with an invalid tool result", () => {
    const parsed = mcpAppsSnapshotContentSchema.safeParse({
      ...validContent,
      result: { content: "not an array" },
    });

    expect(parsed.success).toBe(false);
  });
});
