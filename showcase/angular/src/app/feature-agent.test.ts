import { describe, expect, it } from "vitest";

import { agentIdForFeature, threadIdForFeature } from "./feature-agent";

describe("Angular showcase agent selection", () => {
  it.each([
    ["agentic-chat", "agentic_chat"],
    ["agent-config", "agent-config-demo"],
    ["frontend-tools", "frontend_tools"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["tool-rendering", "tool-rendering"],
  ])("maps %s to backend agent %s", (feature, agentId) => {
    expect(agentIdForFeature(feature, "langgraph-python")).toBe(agentId);
  });

  it("uses bounded integration-specific agent overrides", () => {
    expect(agentIdForFeature("beautiful-chat", "google-adk")).toBe(
      "beautiful-chat",
    );
    expect(agentIdForFeature("agentic-chat", "built-in-agent")).toBe("default");
  });

  it("uses the feature contract when no integration override exists", () => {
    expect(agentIdForFeature("tool-rendering", "langgraph-python")).toBe(
      "tool-rendering",
    );
  });

  it("uses the ENT-658 fixed thread only for its round-trip feature", () => {
    expect(threadIdForFeature("threadid-frontend-tool-roundtrip")).toBe(
      "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
    );
    expect(threadIdForFeature("frontend-tools")).toBeUndefined();
  });
});
