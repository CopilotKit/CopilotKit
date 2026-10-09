import { describe, it, expect, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { CopilotRuntime } from "../copilot-runtime";
import { LangChainAdapter } from "../../../service-adapters/langchain/langchain-adapter";
import { createCopilotEndpointSingleRoute } from "../../../../v2/runtime/endpoints/hono-single";

type ChainFn = ConstructorParameters<typeof LangChainAdapter>[0]["chainFn"];

const baseInput = (overrides: Partial<RunAgentInput> = {}): RunAgentInput => ({
  threadId: "thread-1",
  runId: "run-1",
  messages: [{ id: "u1", role: "user", content: "Hello" }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
  ...overrides,
});

/**
 * Sends one `agent/run` request through the wiring every v1 endpoint uses
 * (`handleServiceAdapter`, then the single-route endpoint), with a real
 * LangChainAdapter, and returns the AG-UI events the browser would receive.
 *
 * The v1 integration modules themselves are not imported: they load the v1
 * GraphQL schema, whose decorators need metadata vitest does not emit.
 */
async function runThroughEndpoint(
  chainFn: ChainFn,
  input: RunAgentInput,
  runtimeOptions: ConstructorParameters<typeof CopilotRuntime>[0] = {},
): Promise<BaseEvent[]> {
  const runtime = new CopilotRuntime(runtimeOptions);
  runtime.handleServiceAdapter(new LangChainAdapter({ chainFn }));
  const app = createCopilotEndpointSingleRoute({
    runtime: runtime.instance,
    basePath: "/api/copilotkit",
  });

  const response = await app.fetch(
    new Request("https://app.example.com/api/copilotkit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "default" },
        body: input,
      }),
    }),
  );
  expect(response.status).toBe(200);

  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as BaseEvent);
}

const types = (events: BaseEvent[]) => events.map((e) => e.type);

describe("LangChainAdapter through the v1 endpoint (#3217)", () => {
  it("runs chainFn and streams its text reply", async () => {
    const chainFn = vi.fn<ChainFn>(async () => new AIMessage("Hi there"));

    const events = await runThroughEndpoint(chainFn, baseInput());

    expect(chainFn).toHaveBeenCalledTimes(1);
    const { messages, threadId } = chainFn.mock.calls[0]![0];
    expect(threadId).toBe("thread-1");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(messages[0]!.content).toBe("Hello");

    expect(types(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    const content = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string } & BaseEvent;
    expect(content.delta).toBe("Hi there");
  });

  it("advertises frontend tools to chainFn and ends the run on a frontend tool call", async () => {
    const chainFn = vi.fn<ChainFn>(
      async () =>
        new AIMessage({
          content: "",
          tool_calls: [
            { id: "call-1", name: "showCard", args: { title: "Ada" } },
          ],
        }),
    );

    const events = await runThroughEndpoint(
      chainFn,
      baseInput({
        tools: [
          {
            name: "showCard",
            description: "Show a card",
            parameters: {
              type: "object",
              properties: { title: { type: "string" } },
            },
          },
        ],
      }),
    );

    expect(chainFn).toHaveBeenCalledTimes(1);
    expect(chainFn.mock.calls[0]![0].tools.map((t) => t.name)).toEqual([
      "showCard",
    ]);

    expect(types(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.RUN_FINISHED,
    ]);
    const args = events.find((e) => e.type === EventType.TOOL_CALL_ARGS) as {
      delta: string;
    } & BaseEvent;
    expect(JSON.parse(args.delta)).toEqual({ title: "Ada" });
  });

  it("executes a server-side v1 action and feeds its result back to chainFn", async () => {
    const handler = vi.fn(async ({ name }: { name: string }) => `hi ${name}`);
    const seen: BaseMessage[][] = [];
    const chainFn = vi.fn<ChainFn>(async ({ messages }) => {
      seen.push(messages);
      return seen.length === 1
        ? new AIMessage({
            content: "",
            tool_calls: [
              { id: "call-1", name: "greet", args: { name: "Ada" } },
            ],
          })
        : new AIMessage("Greeted Ada");
    });

    const events = await runThroughEndpoint(chainFn, baseInput(), {
      actions: [
        {
          name: "greet",
          description: "Greet someone",
          parameters: [{ name: "name", type: "string" }],
          handler,
        },
      ],
    });

    expect(chainFn.mock.calls[0]![0].tools.map((t) => t.name)).toEqual([
      "greet",
    ]);
    expect(handler).toHaveBeenCalledWith({ name: "Ada" });
    expect(chainFn).toHaveBeenCalledTimes(2);

    const toolMessage = seen[1]!.find((m) => m instanceof ToolMessage) as
      | ToolMessage
      | undefined;
    expect(toolMessage?.content).toBe("hi Ada");
    expect(toolMessage?.tool_call_id).toBe("call-1");

    const result = events.find(
      (e) => e.type === EventType.TOOL_CALL_RESULT,
    ) as { content: string; toolCallId: string } & BaseEvent;
    expect(result).toMatchObject({ toolCallId: "call-1", content: "hi Ada" });
    expect(types(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("passes application context to chainFn as a system message", async () => {
    const chainFn = vi.fn<ChainFn>(async () => new AIMessage("ok"));

    await runThroughEndpoint(
      chainFn,
      baseInput({
        context: [{ description: "The user's plan", value: "Enterprise" }],
      }),
    );

    const [first] = chainFn.mock.calls[0]![0].messages;
    expect(first).toBeInstanceOf(SystemMessage);
    expect(first!.content).toContain("The user's plan");
    expect(first!.content).toContain("Enterprise");
  });

  it("reports a chainFn failure as RUN_ERROR", async () => {
    const events = await runThroughEndpoint(async () => {
      throw new Error("chain exploded");
    }, baseInput());

    const error = events.find((e) => e.type === EventType.RUN_ERROR) as {
      message: string;
    } & BaseEvent;
    expect(error?.message).toContain("chain exploded");
  });
});
