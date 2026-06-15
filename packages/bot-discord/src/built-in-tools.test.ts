import { describe, it, expect, vi } from "vitest";
import { lookupDiscordUserTool, defaultDiscordTools } from "./built-in-tools.js";

describe("lookupDiscordUserTool", () => {
  it("resolves a query via thread.lookupUser and returns a mention", async () => {
    const thread = { lookupUser: vi.fn(async () => ({ id: "u9", name: "Ann", handle: "ann" })) };
    const res = await lookupDiscordUserTool.handler({ query: "ann" }, { thread } as any);
    expect(thread.lookupUser).toHaveBeenCalledWith("ann");
    expect(JSON.stringify(res)).toContain("<@u9>");
  });
  it("is included in defaultDiscordTools", () => {
    expect(defaultDiscordTools).toContain(lookupDiscordUserTool);
  });
});
