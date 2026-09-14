import { describe, expect, it } from "vitest";

import { buildAgentContextPrompt, buildStatePrompt } from "./state";

describe("buildAgentContextPrompt", () => {
  it("uses only the current run context and preserves the user request", () => {
    const first = buildAgentContextPrompt(
      {
        context: [
          {
            description: "Agent response preferences",
            value: JSON.stringify({ tone: "formal", responseLength: "short" }),
          },
        ],
      } as never,
      "Explain closures",
    );
    const second = buildAgentContextPrompt(
      {
        context: [
          {
            description: "Agent response preferences",
            value: JSON.stringify({ tone: "casual", responseLength: "long" }),
          },
        ],
      } as never,
      "Explain closures again",
    );

    expect(first).toContain("formal");
    expect(first).toContain("Explain closures");
    expect(second).toContain("casual");
    expect(second).toContain("Explain closures again");
    expect(second).not.toContain("formal");
    expect(second.match(/Context for this conversation/g)).toHaveLength(1);
  });

  it("leaves the prompt unchanged for missing or malformed context", () => {
    expect(buildAgentContextPrompt({}, "Hello")).toBe("Hello");
    expect(
      buildAgentContextPrompt(
        { context: [null, "bad", { description: null, value: null }] },
        "Hello",
      ),
    ).toBe("Hello");
  });

  it("is composed into the registered shared-state builder", () => {
    const prompt = buildStatePrompt(
      {
        state: { todos: ["Follow up"] },
        context: [{ description: "Tone", value: "concise" }],
      } as never,
      "Draft a reply",
    );

    expect(prompt).toContain("Current sales pipeline");
    expect(prompt).toContain("- Tone: concise");
    expect(prompt.match(/User request: Draft a reply/g)).toHaveLength(1);
  });
});
