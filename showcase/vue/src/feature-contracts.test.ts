import { describe, expect, it } from "vitest";

import { agentIdForFeature, suggestionsForFeature } from "./feature-contracts";

describe("Vue showcase feature contracts", () => {
  it("selects the canonical agentic-chat backend agent", () => {
    expect(agentIdForFeature("agentic-chat")).toBe("agentic_chat");
  });

  it("does not add static suggestions to agentic chat", () => {
    expect(suggestionsForFeature("agentic-chat")).toEqual([]);
  });
});
