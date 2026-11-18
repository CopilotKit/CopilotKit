import { describe, expect, it } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import { runClassicAgent } from "./agent-test-helpers";
import type { ClassicTestConfig } from "./agent-test-helpers";

/** Runs a classic agent once and returns the one model request it made. */
async function firstRequest(
  config: ClassicTestConfig,
  input?: Partial<RunAgentInput>,
) {
  const { requests } = await runClassicAgent(config, [{ text: "Hi!" }], input);
  expect(requests).toHaveLength(1);
  return requests[0];
}

describe("BuiltInAgent system prompt through the real chat()", () => {
  it("sends the prompt when the run has no conversation messages", async () => {
    const request = await firstRequest({ prompt: "Greet the user." });

    expect(request.systemPrompts).toEqual(["Greet the user."]);
    expect(request.messages).toEqual([]);
  });

  it("sends the prompt ahead of the conversation", async () => {
    const request = await firstRequest(
      { prompt: "Be brief." },
      { messages: [{ id: "user", role: "user", content: "Hello" }] },
    );

    expect(request.systemPrompts).toEqual(["Be brief."]);
    expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("sends forwarded system and developer messages as system prompts after the agent prompt", async () => {
    const request = await firstRequest(
      {
        prompt: "Be brief.",
        forwardSystemMessages: true,
        forwardDeveloperMessages: true,
      },
      {
        messages: [
          { id: "system", role: "system", content: "Answer in French." },
          { id: "developer", role: "developer", content: "Use metric units." },
          { id: "user", role: "user", content: "Hello" },
        ],
      },
    );

    expect(request.systemPrompts).toEqual([
      "Be brief.",
      "Answer in French.",
      "Use metric units.",
    ]);
    expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("drops system and developer messages unless forwarding is on", async () => {
    const request = await firstRequest(
      { prompt: "Be brief." },
      {
        messages: [
          { id: "system", role: "system", content: "Answer in French." },
          { id: "developer", role: "developer", content: "Use metric units." },
          { id: "user", role: "user", content: "Hello" },
        ],
      },
    );

    expect(request.systemPrompts).toEqual(["Be brief."]);
    expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
  });
});
