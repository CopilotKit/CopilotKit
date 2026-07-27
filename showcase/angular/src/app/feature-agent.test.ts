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

  it("uses the BuiltIn runtime's default agent for ordinary features", () => {
    expect(agentIdForFeature("beautiful-chat", "google-adk")).toBe(
      "beautiful-chat",
    );
    for (const feature of [
      "agentic-chat",
      "agent-config",
      "auth",
      "beautiful-chat",
      "frontend-tools",
      "tool-rendering",
    ]) {
      expect(agentIdForFeature(feature, "built-in-agent")).toBe("default");
    }
  });

  it.each([
    ["reasoning-custom", "agentic-chat-reasoning"],
    ["reasoning-default", "reasoning-default-render"],
    ["tool-rendering-reasoning-chain", "tool-rendering-reasoning-chain"],
  ])("preserves BuiltIn's named %s agent", (feature, agentId) => {
    expect(agentIdForFeature(feature, "built-in-agent")).toBe(agentId);
  });

  it.each([
    ["reasoning-custom", "agentic-chat-reasoning"],
    ["reasoning-default", "reasoning-default-render"],
  ])("uses LlamaIndex's named %s agent", (feature, agentId) => {
    expect(agentIdForFeature(feature, "llamaindex")).toBe(agentId);
  });

  it("preserves PydanticAI's hyphenated frontend-tools agent", () => {
    expect(agentIdForFeature("frontend-tools", "pydantic-ai")).toBe(
      "frontend-tools",
    );
  });

  it("uses the feature contract when no integration override exists", () => {
    expect(agentIdForFeature("tool-rendering", "langgraph-python")).toBe(
      "tool-rendering",
    );
    expect(agentIdForFeature("reasoning-custom", "langgraph-python")).toBe(
      "reasoning-custom",
    );
  });

  it("uses the ENT-658 fixed thread only for its round-trip feature", () => {
    expect(threadIdForFeature("threadid-frontend-tool-roundtrip")).toBe(
      "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
    );
    expect(threadIdForFeature("frontend-tools")).toBeUndefined();
  });
});
