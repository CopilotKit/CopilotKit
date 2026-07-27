import { describe, expect, it } from "vitest";

import { usesFrontendSchedulingTool } from "./interrupt-mode";

describe("usesFrontendSchedulingTool", () => {
  it("selects Google ADK's frontend-tool interrupt strategy", () => {
    expect(usesFrontendSchedulingTool("gen-ui-interrupt", "google-adk")).toBe(
      true,
    );
  });

  it("preserves native interrupts and unrelated Google ADK features", () => {
    expect(usesFrontendSchedulingTool("gen-ui-interrupt", "mastra")).toBe(
      false,
    );
    expect(usesFrontendSchedulingTool("hitl-in-chat", "google-adk")).toBe(
      false,
    );
  });
});
