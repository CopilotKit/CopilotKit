import { describe, expect, it } from "vitest";

import { agentIdForFeature } from "./feature-agent";

describe("Angular showcase agent selection", () => {
  it.each([
    ["agentic-chat", "agentic_chat"],
    ["frontend-tools", "frontend_tools"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["tool-rendering", "tool-rendering"],
  ])("maps %s to backend agent %s", (feature, agentId) => {
    expect(agentIdForFeature(feature)).toBe(agentId);
  });
});
