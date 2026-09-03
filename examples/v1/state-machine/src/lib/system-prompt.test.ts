import { describe, expect, test } from "vitest";

import { stageInstructions, systemPrompt } from "./system-prompt";

describe("stageInstructions", () => {
  test("ends the build-car instruction after its final complete sentence", () => {
    expect(stageInstructions.buildCar).toMatch(/just show them\.$/);
  });

  test("tells the agent to answer financing questions before choosing a tool", () => {
    expect(stageInstructions.sellFinancing).toContain(
      "Answer the user's questions and then call",
    );
  });

  test("uses a complete fallback instruction", () => {
    expect(systemPrompt).toContain("let them know that they cannot do that");
  });
});
