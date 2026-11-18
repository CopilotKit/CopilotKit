/**
 * The TanStack AI `chat()` options of a classic config. The agent passes them
 * to the real `chat()`, which sends them to a fake model that records each
 * request. The agent's own keys (the model, the messages, the thread, the
 * stream) win over any config key of the same name.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { maxIterations } from "@tanstack/ai";
import type { ChatMiddleware } from "@tanstack/ai";
import { z } from "zod";
import { defineTool } from "../index";
import {
  createFakeModel,
  eventsOfType,
  runClassicAgent,
} from "./agent-test-helpers";
import type { ClassicTestConfig } from "./agent-test-helpers";

const USER_MESSAGE: RunAgentInput["messages"] = [
  { id: "u1", role: "user", content: "Hello" },
];

/**
 * A `count_items` tool whose `execute` records the arguments it got. Its
 * schema takes a number, so a model that sends `"5"` fails the schema.
 */
function countItemsTool() {
  const calls: unknown[] = [];
  const tool = defineTool({
    name: "count_items",
    description: "Count items",
    parameters: z.object({ count: z.number() }),
    execute: async (args) => {
      calls.push(args);
      return { ok: true };
    },
  });
  return { tool, calls };
}

/** A model response that calls `count_items` with `input`. */
function callCountItems(input: unknown) {
  return { toolCalls: [{ id: "tc-1", name: "count_items", input }] };
}

describe("BuiltInAgent chat() options", () => {
  it("sends the pass-through options to the model", async () => {
    const { requests } = await runClassicAgent(
      {
        metadata: { team: "billing" },
        promptCache: { retention: "long", key: "billing-agent" },
      },
      [{}],
      { messages: USER_MESSAGE },
    );

    expect(requests[0]).toMatchObject({
      metadata: { team: "billing" },
      promptCache: { retention: "long", key: "billing-agent" },
    });
  });

  it("gives the middleware hooks the configured context", async () => {
    const seen: unknown[] = [];
    const recordContext: ChatMiddleware<{ service: string }> = {
      onStart(ctx) {
        seen.push(ctx.context);
      },
    };

    await runClassicAgent(
      { context: { service: "billing" }, middleware: [recordContext] },
      [{}],
      { messages: USER_MESSAGE },
    );

    expect(seen).toEqual([{ service: "billing" }]);
  });

  it("keeps its own model, messages, thread, and stream over config keys of the same name", async () => {
    const other = createFakeModel([{ text: "from the other model" }]);
    // A JavaScript caller can pass keys the config type does not have.
    const config = {
      prompt: "Be brief.",
      adapter: other.model,
      messages: [{ role: "user", content: "injected" }],
      threadId: "injected-thread",
      stream: false,
    };

    const { events, requests } = await runClassicAgent(
      config,
      [{ text: "from the agent's model" }],
      { messages: USER_MESSAGE, threadId: "agent-thread" },
    );

    expect(other.requests).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      threadId: "agent-thread",
      messages: [{ role: "user", content: "Hello" }],
    });
    const text = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)
      .map((event) => event.delta)
      .join("");
    expect(text).toBe("from the agent's model");
  });

  it("drops keys the agent owns that are not chat() pass-through options", async () => {
    // outputSchema would turn chat() into a promise of the parsed output.
    const config = {
      prompt: "Be brief.",
      outputSchema: z.object({ answer: z.string() }),
      runId: "injected-run",
      state: { injected: true },
    };

    const { events, requests } = await runClassicAgent(
      config,
      [{ text: "streamed" }],
      { messages: USER_MESSAGE, runId: "agent-run" },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("outputSchema");
    expect(requests[0]?.runId).not.toBe("injected-run");
    expect(requests[0]).not.toHaveProperty("state");
    const text = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)
      .map((event) => event.delta)
      .join("");
    expect(text).toBe("streamed");
  });

  it("sends the prompt, then systemPrompts, then the context, then forwarded system messages", async () => {
    const { requests } = await runClassicAgent(
      {
        prompt: "Be brief.",
        systemPrompts: ["Use metric units.", { content: "Answer in French." }],
        forwardSystemMessages: true,
      },
      [{}],
      {
        messages: [
          { id: "s1", role: "system", content: "Forwarded rule." },
          ...USER_MESSAGE,
        ],
        context: [{ description: "User", value: "Ada" }],
      },
    );

    expect(requests[0].systemPrompts).toEqual([
      "Be brief.",
      "Use metric units.",
      { content: "Answer in French." },
      "\n## Context from the application\nUser:\nAda\n",
      "Forwarded rule.",
    ]);
  });

  it("sends systemPrompts without a prompt", async () => {
    const { requests } = await runClassicAgent(
      { systemPrompts: ["Use metric units."] },
      [{}],
      { messages: USER_MESSAGE },
    );

    expect(requests[0].systemPrompts).toEqual(["Use metric units."]);
  });

  it("uses agentLoopStrategy instead of maxSteps", async () => {
    const { tool } = countItemsTool();
    const config: ClassicTestConfig = { tools: [tool], maxSteps: 1 };

    const limited = await runClassicAgent(
      config,
      [callCountItems({ count: 1 }), { text: "done" }],
      { messages: USER_MESSAGE },
    );
    const looped = await runClassicAgent(
      { ...config, agentLoopStrategy: maxIterations(2) },
      [callCountItems({ count: 1 }), { text: "done" }],
      { messages: USER_MESSAGE },
    );

    expect(limited.requests).toHaveLength(1);
    expect(looped.requests).toHaveLength(2);
  });

  it("does not repair tool input by default", async () => {
    const { tool, calls } = countItemsTool();

    const { events } = await runClassicAgent(
      { tools: [tool] },
      [callCountItems({ count: "5" })],
      { messages: USER_MESSAGE },
    );

    expect(calls).toEqual([]);
    const [result] = eventsOfType(events, EventType.TOOL_CALL_RESULT);
    expect(result?.content).toContain("count");
  });

  it("repairs tool input with a configured repairToolInput", async () => {
    const { tool, calls } = countItemsTool();

    await runClassicAgent(
      { tools: [tool], repairToolInput: () => ({ count: 5 }) },
      [callCountItems({ count: "5" })],
      { messages: USER_MESSAGE },
    );

    expect(calls).toEqual([{ count: 5 }]);
  });
});
