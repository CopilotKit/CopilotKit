import { describe, expect, it } from "vitest";

import { runtimePathForFeature } from "./cell-context";
import { agentIdForFeature, threadIdForFeature } from "./feature-agent";

const BUILT_IN_REACT_BINDINGS = [
  [
    "a2ui-fixed-schema",
    "/api/copilotkit-a2ui-fixed-schema",
    "a2ui-fixed-schema",
  ],
  ["a2ui-recovery", "/api/copilotkit-a2ui-recovery", "a2ui-recovery"],
  ["agent-config", "/api/copilotkit-agent-config", "agent-config-demo"],
  ["agentic-chat", "/api/copilotkit", "agentic_chat"],
  ["auth", "/api/copilotkit-auth", "auth-demo"],
  ["beautiful-chat", "/api/copilotkit-beautiful-chat", "beautiful-chat"],
  ["chat-customization-css", "/api/copilotkit", "chat-customization-css"],
  ["chat-slots", "/api/copilotkit", "chat-slots"],
  [
    "declarative-gen-ui",
    "/api/copilotkit-declarative-gen-ui",
    "declarative-gen-ui",
  ],
  ["frontend-tools", "/api/copilotkit", "frontend_tools"],
  ["frontend-tools-async", "/api/copilotkit", "frontend-tools-async"],
  ["gen-ui-agent", "/api/copilotkit", "gen-ui-agent"],
  ["gen-ui-tool-based", "/api/copilotkit", "gen-ui-tool-based"],
  ["headless-complete", "/api/copilotkit-mcp-apps", "headless-complete"],
  ["headless-simple", "/api/copilotkit", "headless-simple"],
  ["hitl-in-app", "/api/copilotkit", "hitl-in-app"],
  ["hitl-in-chat", "/api/copilotkit", "hitl-in-chat"],
  ["mcp-apps", "/api/copilotkit-mcp-apps", "mcp-apps"],
  ["multimodal", "/api/copilotkit-multimodal", "multimodal-demo"],
  ["open-gen-ui", "/api/copilotkit-ogui", "open-gen-ui"],
  ["open-gen-ui-advanced", "/api/copilotkit-ogui", "open-gen-ui-advanced"],
  ["prebuilt-popup", "/api/copilotkit", "prebuilt-popup"],
  ["prebuilt-sidebar", "/api/copilotkit", "prebuilt-sidebar"],
  [
    "readonly-state-agent-context",
    "/api/copilotkit",
    "readonly-state-agent-context",
  ],
  ["reasoning-custom", "/api/copilotkit", "reasoning-custom"],
  ["reasoning-default", "/api/copilotkit", "reasoning-default"],
  ["shared-state-read", "/api/copilotkit", "shared-state-read"],
  ["shared-state-read-write", "/api/copilotkit", "shared-state-read-write"],
  ["subagents", "/api/copilotkit", "subagents"],
  ["tool-rendering", "/api/copilotkit", "tool-rendering"],
  [
    "tool-rendering-custom-catchall",
    "/api/copilotkit",
    "tool-rendering-custom-catchall",
  ],
  [
    "tool-rendering-default-catchall",
    "/api/copilotkit",
    "tool-rendering-default-catchall",
  ],
  ["voice", "/api/copilotkit-voice", "voice-demo"],
] as const;

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

  it.each(BUILT_IN_REACT_BINDINGS)(
    "matches React's BuiltIn binding for %s",
    (feature, runtimeUrl, agentId) => {
      expect(runtimePathForFeature(feature)).toBe(runtimeUrl);
      expect(agentIdForFeature(feature, "built-in-agent")).toBe(agentId);
    },
  );

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
