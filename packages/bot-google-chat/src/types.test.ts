// types.test.ts
import { describe, it, expect } from "vitest";
import { conversationKeyOf, DM_SCOPE } from "./types.js";

describe("conversationKeyOf", () => {
  it("joins spaceId and scope with ::", () => {
    expect(
      conversationKeyOf({ spaceId: "spaces/AAA", scope: "threads/T1" }),
    ).toBe("spaces/AAA::threads/T1");
  });
  it("uses the DM sentinel scope for direct messages", () => {
    expect(conversationKeyOf({ spaceId: "spaces/DM1", scope: DM_SCOPE })).toBe(
      "spaces/DM1::dm",
    );
  });
});
