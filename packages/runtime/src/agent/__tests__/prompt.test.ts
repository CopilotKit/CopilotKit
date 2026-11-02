import { describe, expect, it } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import {
  buildAgentSystemPrompt,
  formatContextSection,
  formatStateSection,
} from "../prompt";

type PromptInput = Pick<RunAgentInput, "context" | "state">;

function createInput(overrides?: Partial<PromptInput>): PromptInput {
  return { context: [], state: undefined, ...overrides };
}

const userContext = [
  { description: "Current user", value: "Ada" },
  { description: "Plan", value: "pro" },
];

const STATE_PREAMBLE =
  "\n## Application State\n" +
  "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n";

describe("buildAgentSystemPrompt", () => {
  it("returns the configured prompt alone", () => {
    expect(
      buildAgentSystemPrompt(createInput(), { prompt: "You are helpful." }),
    ).toBe("You are helpful.");
  });

  it("returns only the context section when there is no prompt or state", () => {
    expect(
      buildAgentSystemPrompt(createInput({ context: userContext }), {}),
    ).toBe(
      "\n## Context from the application\nCurrent user:\nAda\nPlan:\npro\n",
    );
  });

  it("returns only the state section when there is no prompt or context", () => {
    expect(
      buildAgentSystemPrompt(createInput({ state: { count: 1 } }), {}),
    ).toBe(STATE_PREAMBLE + '```json\n{\n  "count": 1\n}\n```\n');
  });

  it("puts prompt, then context, then state", () => {
    const result = buildAgentSystemPrompt(
      createInput({ context: userContext, state: { count: 1 } }),
      { prompt: "You are helpful." },
    );
    expect(result).toBe(
      "You are helpful.\n" +
        "## Context from the application\n" +
        "Current user:\nAda\n" +
        "Plan:\npro\n" +
        "\n## Application State\n" +
        "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
        "```json\n" +
        "{\n" +
        '  "count": 1\n' +
        "}\n" +
        "```\n",
    );
  });

  it("leaves out an empty state object", () => {
    expect(
      buildAgentSystemPrompt(createInput({ state: {} }), { prompt: "Hi" }),
    ).toBe("Hi");
  });

  it("leaves out a null state", () => {
    expect(
      buildAgentSystemPrompt(createInput({ state: null }), { prompt: "Hi" }),
    ).toBe("Hi");
  });

  it("returns undefined when there is no prompt, context, or state", () => {
    expect(buildAgentSystemPrompt(createInput(), {})).toBeUndefined();
  });

  it("treats an empty prompt string as no prompt", () => {
    expect(
      buildAgentSystemPrompt(createInput(), { prompt: "" }),
    ).toBeUndefined();
  });
});

describe("formatContextSection", () => {
  it("returns undefined for an empty context list", () => {
    expect(formatContextSection([])).toBeUndefined();
  });
});

describe("formatStateSection", () => {
  it("keeps falsy non-object state such as 0", () => {
    expect(formatStateSection(0)).toBe(STATE_PREAMBLE + "```json\n0\n```\n");
  });
});
