/**
 * Token usage on RUN_FINISHED for `aiSdkAgent` runs, through a real
 * `streamText`. Factory-mode usage (hand-built stream parts) is covered in
 * `agent/__tests__/run-finished-usage.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import { defineTool } from "../../agent";
import {
  collectEvents,
  createDefaultInput,
} from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import { modelEmittingTurns, textParts, toolCallPart } from "./mock-model";
import type { StreamPart } from "./mock-model";
import { z } from "zod";

function finishPart(
  unified: "stop" | "tool-calls",
  input: number,
  output: number,
): StreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: {
        total: input,
        noCache: input,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: output, text: output, reasoning: 0 },
    },
  };
}

function textTurn(input: number, output: number) {
  return [...textParts("ok"), finishPart("stop", input, output)];
}

function pingTurn(input: number, output: number) {
  return [
    toolCallPart("tc-1", "ping", {}),
    finishPart("tool-calls", input, output),
  ];
}

const pingTool = defineTool({
  name: "ping",
  description: "Ping.",
  parameters: z.object({}),
  execute: async () => "pong",
});

async function runFinished(agent: ReturnType<typeof aiSdkAgent>) {
  const events = await collectEvents(
    agent.run(
      createDefaultInput({
        messages: [{ id: "u1", role: "user", content: "Hi" }],
      }),
    ),
  );
  const finished = events.filter(
    (event) => event.type === EventType.RUN_FINISHED,
  );
  expect(finished).toHaveLength(1);
  return finished[0];
}

describe("aiSdkAgent RUN_FINISHED usage", () => {
  it("reports the run's token usage and finish reason", async () => {
    const agent = aiSdkAgent({ model: modelEmittingTurns([textTurn(12, 8)]) });

    const finished = await runFinished(agent);

    expect(finished).not.toHaveProperty("finishReason");
    expect(finished).toMatchObject({
      metadata: { finishReason: "stop" },
      usage: [{ inputTokens: 12, outputTokens: 8, totalTokens: 20 }],
    });
  });

  it("adds up the usage of every step in the run", async () => {
    const agent = aiSdkAgent({
      model: modelEmittingTurns([pingTurn(10, 4), textTurn(12, 3)]),
      tools: [pingTool],
      maxSteps: 2,
    });

    const finished = await runFinished(agent);

    expect(finished).toMatchObject({
      metadata: { finishReason: "stop" },
      usage: [{ inputTokens: 22, outputTokens: 7, totalTokens: 29 }],
    });
  });

  it("labels the usage with the model's provider and model id", async () => {
    const agent = aiSdkAgent({
      model: modelEmittingTurns([textTurn(12, 8)]),
    });

    const finished = await runFinished(agent);

    expect(finished).toMatchObject({
      usage: [{ provider: "mock-provider", model: "mock-model-id" }],
    });
  });
});
