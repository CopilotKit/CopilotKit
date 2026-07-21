import { describe, expect, it } from "vitest";

import { resolveFeatureComponentKey } from "./app.routes";
import { suggestionsConfigForFeature } from "./feature-suggestions";

describe("Angular showcase feature routing", () => {
  it.each([
    ["prebuilt-popup", "popup"],
    ["prebuilt-sidebar", "sidebar"],
    ["chat-slots", "chat-slots"],
    ["chat-customization-css", "chat-css"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["gen-ui-tool-based", "tools"],
    ["tool-rendering-default-catchall", "tools"],
    ["tool-rendering-custom-catchall", "tools"],
    ["tool-rendering", "tools"],
    ["tool-rendering-reasoning-chain", "tools"],
    ["frontend-tools", "tools"],
    ["frontend-tools-async", "tools"],
    ["threadid-frontend-tool-roundtrip", "tools"],
    ["hitl-in-chat", "tools"],
    ["hitl-in-app", "tools"],
    ["gen-ui-interrupt", "interrupt"],
    ["interrupt-headless", "interrupt"],
    ["declarative-gen-ui", "a2ui"],
    ["a2ui-fixed-schema", "a2ui"],
    ["a2ui-recovery", "a2ui"],
    ["mcp-apps", "mcp-apps"],
    ["open-gen-ui", "generated-ui"],
    ["open-gen-ui-advanced", "generated-ui"],
    ["shared-state-read-write", "state"],
    ["shared-state-read", "state"],
    ["shared-state-streaming", "state"],
    ["readonly-state-agent-context", "state"],
    ["reasoning-default", "reasoning"],
    ["reasoning-custom", "reasoning"],
    ["gen-ui-agent", "agent-state"],
    ["subagents", "agent-state"],
    ["declarative-hashbrown", "hashbrown"],
    ["agentic-chat", "chat"],
  ])("maps %s to the %s implementation", (feature, expected) => {
    expect(resolveFeatureComponentKey(feature)).toBe(expected);
  });
});

describe("Angular showcase static suggestions", () => {
  it("pins state-demo suggestions to their canonical prompts", () => {
    expect(
      suggestionsConfigForFeature("shared-state-streaming")[0]?.suggestions,
    ).toContainEqual({
      title: "Write a short poem",
      message: "Write a short poem about autumn leaves.",
    });
    expect(
      suggestionsConfigForFeature("readonly-state-agent-context")[0]
        ?.suggestions,
    ).toContainEqual({
      title: "Who am I?",
      message: "What do you know about me from my context?",
    });
  });

  it("does not add feature-specific suggestions to unrelated routes", () => {
    expect(suggestionsConfigForFeature("agentic-chat")).toEqual([]);
  });
});
