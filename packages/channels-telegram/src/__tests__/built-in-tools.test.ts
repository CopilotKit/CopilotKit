import { describe, it, expect, vi } from "vitest";
import {
  lookupTelegramUserTool,
  defaultTelegramTools,
} from "../built-in-tools.js";

describe("lookupTelegramUserTool", () => {
  it("resolves to an @handle mention", async () => {
    const thread = {
      lookupUser: vi.fn(async () => ({ id: "7", name: "Ada", handle: "ada" })),
    };
    const r: any = await lookupTelegramUserTool.handler({ query: "ada" }, {
      thread,
    } as any);
    expect(r).toMatchObject({ found: true, userId: "7", mention: "@ada" });
  });
  it("is included in defaults", () => {
    expect(defaultTelegramTools).toContain(lookupTelegramUserTool);
  });
});
