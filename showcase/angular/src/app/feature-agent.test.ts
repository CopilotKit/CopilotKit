import { describe, expect, it } from "vitest";

import { agentIdForFeature, threadIdForFeature } from "./feature-agent";

const catalog = {
  cells: [
    ...[
      ["agentic-chat", "agentic_chat"],
      ["agent-config", "agent-config-demo"],
      ["frontend-tools", "frontend_tools"],
      ["declarative-hashbrown", "declarative-hashbrown-demo"],
      ["headless-simple", "headless-simple"],
      ["headless-complete", "headless-complete"],
      ["tool-rendering", "tool-rendering"],
    ].map(([feature, agent_id]) => ({
      id: `angular/langgraph-python/${feature}`,
      agent_id,
    })),
    {
      id: "angular/google-adk/beautiful-chat",
      agent_id: "beautiful-chat",
    },
    { id: "angular/built-in-agent/agentic-chat", agent_id: "default" },
  ],
};

describe("Angular showcase agent selection", () => {
  it.each([
    ["agentic-chat", "agentic_chat"],
    ["agent-config", "agent-config-demo"],
    ["frontend-tools", "frontend_tools"],
    ["declarative-hashbrown", "declarative-hashbrown-demo"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["tool-rendering", "tool-rendering"],
  ])("maps %s to backend agent %s", (feature, agentId) => {
    expect(agentIdForFeature(feature, "langgraph-python", catalog)).toBe(
      agentId,
    );
  });

  it("uses the generated cell agent for integration-specific runtimes", () => {
    expect(agentIdForFeature("beautiful-chat", "google-adk", catalog)).toBe(
      "beautiful-chat",
    );
    expect(agentIdForFeature("agentic-chat", "built-in-agent", catalog)).toBe(
      "default",
    );
  });

  it("fails closed when generated cell metadata omits the agent", () => {
    expect(() => agentIdForFeature("agentic-chat", "unknown", catalog)).toThrow(
      'Showcase cell "angular/unknown/agentic-chat" does not declare agent_id.',
    );
  });

  it("uses the ENT-658 fixed thread only for its round-trip feature", () => {
    expect(threadIdForFeature("threadid-frontend-tool-roundtrip")).toBe(
      "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
    );
    expect(threadIdForFeature("frontend-tools")).toBeUndefined();
  });
});
