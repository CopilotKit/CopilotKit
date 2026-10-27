import { describe, expect, it } from "vitest";

import { agentIdForFeature } from "./feature-contracts";

describe("Vue showcase feature contracts", () => {
  it("selects the canonical agentic-chat backend agent", () => {
    expect(agentIdForFeature("agentic-chat")).toBe("agentic_chat");
  });
});
