import { describe, expect, it } from "vitest";

import { agentIdForFeature, threadIdForFeature } from "./feature-agent";

describe("Angular showcase agent selection", () => {
  it.each([
    ["agentic-chat", "agentic_chat"],
    ["frontend-tools", "frontend_tools"],
    ["declarative-hashbrown", "declarative-hashbrown-demo"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["tool-rendering", "tool-rendering"],
  ])("maps %s to backend agent %s", (feature, agentId) => {
    expect(agentIdForFeature(feature)).toBe(agentId);
  });

  it("uses the ENT-658 fixed thread only for its round-trip feature", () => {
    expect(threadIdForFeature("threadid-frontend-tool-roundtrip")).toBe(
      "a9e7e9c4-6c72-4b8a-9d74-c5c0e05f6580",
    );
    expect(threadIdForFeature("frontend-tools")).toBeUndefined();
  });
});
