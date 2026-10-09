import { describe, it, expect, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { CopilotRuntime } from "../copilot-runtime";
import { LegacyServiceAdapterAgent } from "../legacy-service-adapter-agent";
import type { CopilotServiceAdapter } from "../../../service-adapters/service-adapter";
import type { RuntimeEventSubject } from "../../../service-adapters/events";
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

  it("streams a plain string reply", async () => {
    const events = await runThroughEndpoint(
      async () => "Just a string",
      baseInput(),
    );

    const content = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string } & BaseEvent;
    expect(content?.delta).toBe("Just a string");
    expect(types(events).at(-1)).toBe(EventType.RUN_FINISHED);
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

  describe("streaming chainFn (model.bindTools(tools).stream(messages))", () => {
    /** A LangChain-shaped stream: anything with getReader() is consumed. */
    const streamOf = (chunks: AIMessageChunk[]) =>
      new ReadableStream<AIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });
    const toolChunk = (
      index: number,
      fields: { id?: string; name?: string; args: string },
    ) =>
      new AIMessageChunk({
        content: "",
        tool_call_chunks: [{ index, ...fields, type: "tool_call_chunk" }],
      });
    const twoTools = baseInput({
      tools: ["getWeather", "getHotel"].map((name) => ({
        name,
        description: name,
        parameters: { type: "object", properties: {} },
      })),
    });

    it("closes each parallel tool call before opening the next", async () => {
      const events = await runThroughEndpoint(
        async () =>
          streamOf([
            toolChunk(0, { id: "a", name: "getWeather", args: "" }),
            toolChunk(0, { args: "{}" }),
            toolChunk(1, { id: "b", name: "getHotel", args: "" }),
            toolChunk(1, { args: "{}" }),
            new AIMessageChunk({ content: "" }),
          ]) as never,
        twoTools,
      );

      const toolEvents = events
        .filter((e) => e.type.startsWith("TOOL_CALL"))
        .map((e) => `${e.type}:${(e as { toolCallId?: string }).toolCallId}`);
      expect(toolEvents).toEqual([
        "TOOL_CALL_START:a-idx-0",
        "TOOL_CALL_ARGS:a-idx-0",
        "TOOL_CALL_END:a-idx-0",
        "TOOL_CALL_START:b-idx-1",
        "TOOL_CALL_ARGS:b-idx-1",
        "TOOL_CALL_END:b-idx-1",
      ]);
      expect(types(events).at(-1)).toBe(EventType.RUN_FINISHED);
    });

    it("closes the open tool call when the stream ends inside it", async () => {
      const events = await runThroughEndpoint(
        async () =>
          streamOf([
            toolChunk(0, { id: "a", name: "getWeather", args: "" }),
            toolChunk(0, { args: "{}" }),
          ]) as never,
        twoTools,
      );

      expect(
        events
          .filter((e) => e.type === EventType.TOOL_CALL_END)
          .map((e) => (e as { toolCallId?: string }).toolCallId),
      ).toEqual(["a-idx-0"]);
      expect(types(events).at(-1)).toBe(EventType.RUN_FINISHED);
    });
  });

  it("hands parallel tool calls to chainFn as one AIMessage followed by its results", async () => {
    // OpenAI rejects an assistant tool-call message that is not followed by
    // the results for each of its calls, so N single-call AIMessages in a row
    // fail the next model call with a 400.
    const chainFn = vi.fn<ChainFn>(async () => new AIMessage("Both shown."));

    await runThroughEndpoint(
      chainFn,
      baseInput({
        messages: [
          { id: "u1", role: "user", content: "Show cards for Ada and Grace." },
          {
            id: "a1",
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call_a",
                type: "function",
                function: { name: "showCard", arguments: '{"title":"Ada"}' },
              },
              {
                id: "call_b",
                type: "function",
                function: { name: "showCard", arguments: '{"title":"Grace"}' },
              },
            ],
          },
          { id: "t1", role: "tool", toolCallId: "call_a", content: "Shown." },
          { id: "t2", role: "tool", toolCallId: "call_b", content: "Shown." },
        ],
      }),
    );

    const { messages } = chainFn.mock.calls[0]![0];
    expect(messages.map((m) => m.constructor.name)).toEqual([
      "HumanMessage",
      "AIMessage",
      "ToolMessage",
      "ToolMessage",
    ]);
    expect((messages[1] as AIMessage).tool_calls?.map((c) => c.id)).toEqual([
      "call_a",
      "call_b",
    ]);
  });

  it("streams the text parts of array content (Anthropic-style AIMessage)", async () => {
    const events = await runThroughEndpoint(
      async () =>
        new AIMessage({
          content: [
            { type: "text", text: "Checking the weather." },
            { type: "tool_use", id: "t1", name: "getWeather", input: {} },
          ],
          tool_calls: [{ id: "t1", name: "getWeather", args: {} }],
        }),
      baseInput({
        tools: [
          {
            name: "getWeather",
            description: "weather",
            parameters: { type: "object", properties: {} },
          },
        ],
      }),
    );

    const content = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string } & BaseEvent;
    expect(content?.delta).toBe("Checking the weather.");
    expect(types(events).at(-1)).toBe(EventType.RUN_FINISHED);
  });
});

describe("LegacyServiceAdapterAgent.abortRun", () => {
  it("stops a run whose adapter stream never finishes", async () => {
    const process = vi.fn<CopilotServiceAdapter["process"]>(
      async ({ eventSource }) => {
        eventSource.stream(async (eventStream$: RuntimeEventSubject) => {
          eventStream$.sendTextMessageStart({ messageId: "m1" });
          eventStream$.sendTextMessageContent({
            messageId: "m1",
            content: "partial",
          });
          // Never completes: a model call the user wants to stop.
          await new Promise(() => {});
        });
        return { threadId: "thread-1" };
      },
    );
    const agent = new LegacyServiceAdapterAgent({ name: "Hanging", process });

    const seen: string[] = [];
    const finished = new Promise<"complete" | "error">((resolve) => {
      agent.run(baseInput()).subscribe({
        next: (event) => {
          seen.push(event.type);
          if (event.type === EventType.TEXT_MESSAGE_CONTENT) agent.abortRun();
        },
        complete: () => resolve("complete"),
        error: () => resolve("error"),
      });
    });
    const outcome = await Promise.race([
      finished,
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 1000),
      ),
    ]);

    expect(outcome).toBe("complete");
    expect(seen).not.toContain(EventType.RUN_ERROR);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("cancels the model stream of a LangChainAdapter on Stop", async () => {
    // Without this the run ends for the user, but the model keeps streaming
    // (and billing) in the background until it finishes on its own.
    let pulls = 0;
    let cancelled = false;
    const endless = new ReadableStream<AIMessageChunk>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        pulls++;
        controller.enqueue(new AIMessageChunk({ content: `tok${pulls} ` }));
      },
      cancel() {
        cancelled = true;
      },
    });
    const agent = new LegacyServiceAdapterAgent(
      new LangChainAdapter({ chainFn: async () => endless as never }),
    );

    await new Promise<void>((resolve) => {
      agent.run(baseInput()).subscribe({
        next: (event) => {
          if (event.type === EventType.TEXT_MESSAGE_CONTENT) agent.abortRun();
        },
        complete: () => resolve(),
        error: () => resolve(),
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pullsAfterStop = pulls;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cancelled).toBe(true);
    expect(pulls).toBe(pullsAfterStop);
  });
});
