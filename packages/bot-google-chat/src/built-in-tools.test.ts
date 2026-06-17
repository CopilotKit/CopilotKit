// built-in-tools.test.ts
import { describe, it, expect } from "vitest";
import { lookupGoogleChatUserTool, defaultGoogleChatTools } from "./built-in-tools.js";

describe("lookupGoogleChatUserTool", () => {
  it("returns a <users/ID> mention on success", async () => {
    const thread = { lookupUser: async () => ({ id: "users/42", name: "Ada" }) } as any;
    const res = await (lookupGoogleChatUserTool as any).handler({ query: "Ada" }, { thread });
    expect(res).toMatchObject({ found: true, mention: "<users/42>" });
  });
  it("is included in defaultGoogleChatTools", () => {
    expect(defaultGoogleChatTools).toContain(lookupGoogleChatUserTool);
  });
});
