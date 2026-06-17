// built-in-tools.test.ts
import { describe, it, expect } from "vitest";
import { lookupGoogleChatUserTool, defaultGoogleChatTools } from "./built-in-tools.js";

describe("lookupGoogleChatUserTool", () => {
  it("returns a <users/ID> mention on success", async () => {
    const thread = { lookupUser: async () => ({ id: "users/42", name: "Ada" }) } as any;
    const res = await (lookupGoogleChatUserTool as any).handler({ query: "Ada" }, { thread });
    expect(res).toMatchObject({ found: true, mention: "<users/42>" });
  });
  it("returns { found: false } when lookupUser yields no user", async () => {
    const thread = { lookupUser: async () => undefined } as any;
    const res = await (lookupGoogleChatUserTool as any).handler({ query: "Nobody" }, { thread });
    expect(res).toMatchObject({ found: false, query: "Nobody" });
  });
});

describe("defaultGoogleChatTools", () => {
  it("is empty in v1 (no platform-universal tools shipped by default)", () => {
    expect(defaultGoogleChatTools).toHaveLength(0);
  });
  it("does NOT include lookupGoogleChatUserTool (opt-in only)", () => {
    expect(defaultGoogleChatTools).not.toContain(lookupGoogleChatUserTool);
  });
});
