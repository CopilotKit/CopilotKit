import { describe, expect, it } from "vitest";

import {
  agentIdForFeature,
  suggestionsForFeature,
  threadIdForFeature,
} from "./feature-contracts";

describe("Vue showcase feature contracts", () => {
  it("selects the canonical agentic-chat backend agent", () => {
    expect(agentIdForFeature("agentic-chat", "langgraph-python")).toBe(
      "agentic_chat",
    );
  });

  it("preserves existing integration agent overrides", () => {
    expect(agentIdForFeature("reasoning-default", "llamaindex")).toBe(
      "reasoning-default-render",
    );
    expect(agentIdForFeature("frontend-tools", "pydantic-ai")).toBe(
      "frontend-tools",
    );
  });

  it("keeps the fixed thread scoped to its regression feature", () => {
    expect(threadIdForFeature("threadid-frontend-tool-roundtrip")).toBe(
      "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
    );
    expect(threadIdForFeature("agentic-chat")).toBeUndefined();
  });

  it("does not add static suggestions to agentic chat", () => {
    expect(suggestionsForFeature("agentic-chat")).toEqual([]);
  });
});
