import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent, FileStorage, SessionManager } from "@strands-agents/sdk";
import type {
  MessagesSnapshotEvent,
  ToolCallStartEvent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/core";
import { buildRichChatAgent, buildShowcaseAgent } from "./agent";
import { createModel } from "./model-factory";

const calls = [
  { id: "call_mode", name: "enableAppMode", args: {} },
  {
    id: "call_todo",
    name: "manage_sales_todos",
    args: {
      todos: [
        {
          title: "Original call",
          description: "Keep my identity",
          status: "pending",
        },
      ],
    },
  },
  {
    id: "call_chart",
    name: "pieChart",
    args: { title: "Revenue", data: [{ label: "A", value: 10 }] },
  },
];
const frontendTools = ["enableAppMode", "pieChart"].map((name) => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
}));

// Exercise the real published OpenAI converter and SDK aggregation, rather than
// handing the adapter already assembled ToolUseBlocks. Both APIs receive the
// same calls, with all starts preceding the interleaved argument fragments.
function providerResponse(
  responses: boolean,
  textOnly: boolean,
  batch = calls,
) {
  let events: object[];
  if (responses) {
    events = [{ type: "response.created", response: { id: "resp_test" } }];
    if (textOnly) {
      events.push({
        type: "response.output_text.delta",
        delta: "All three original calls are retained.",
      });
    } else {
      events.push(
        ...batch.map((call, i) => ({
          type: "response.output_item.added",
          output_index: i,
          item: {
            type: "function_call",
            id: `fc_${i}`,
            call_id: call.id,
            name: call.name,
            arguments: "",
          },
        })),
      );
      for (const half of [0, 1]) {
        batch.forEach((call, i) => {
          const args = JSON.stringify(call.args);
          const split = Math.ceil(args.length / 2);
          events.push({
            type: "response.function_call_arguments.delta",
            item_id: `fc_${i}`,
            delta: half === 0 ? args.slice(0, split) : args.slice(split),
          });
        });
      }
    }
    events.push({
      type: "response.completed",
      response: { id: "resp_test", status: "completed" },
    });
  } else {
    const deltas: object[] = textOnly
      ? [
          {
            role: "assistant",
            content: "All three original calls are retained.",
          },
        ]
      : [
          {
            role: "assistant",
            tool_calls: batch.map((call, i) => ({
              index: i,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: "" },
            })),
          },
        ];
    if (!textOnly)
      for (const half of [0, 1])
        deltas.push({
          tool_calls: batch.map((call, i) => {
            const args = JSON.stringify(call.args);
            const split = Math.ceil(args.length / 2);
            return {
              index: i,
              function: {
                arguments:
                  half === 0 ? args.slice(0, split) : args.slice(split),
              },
            };
          }),
        });
    events = deltas.map((delta) => ({
      choices: [{ index: 0, delta, finish_reason: null }],
    }));
    events.push({
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: textOnly ? "stop" : "tool_calls",
        },
      ],
    });
  }
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
      "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function input(threadId: string, messages: Message[]): RunAgentInput {
  return {
    threadId,
    runId: crypto.randomUUID(),
    messages,
    state: {},
    tools: frontendTools,
    context: [],
    forwardedProps: {},
  };
}
async function collect(
  agent: Awaited<ReturnType<typeof buildRichChatAgent>>,
  run: RunAgentInput,
) {
  const events: BaseEvent[] = [];
  for await (const event of agent.run(run)) events.push(event);
  expect(events.filter((event) => event.type === "RUN_ERROR")).toEqual([]);
  const snapshots = events.filter(
    (event): event is MessagesSnapshotEvent =>
      event.type === "MESSAGES_SNAPSHOT",
  );
  return { events, messages: snapshots.at(-1)!.messages };
}
function retainedCalls(messages: Message[]) {
  return messages
    .flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    )
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      args: JSON.parse(call.function.arguments),
    }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("published provider parallel-call history", () => {
  it("keeps incremental tool arguments on the shared streaming-demo agent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    vi.stubEnv("MODEL_PROVIDER", "openai");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      providerResponse(String(url).includes("/responses"), false, [calls[2]]),
    );
    const result = await collect(
      await buildShowcaseAgent(),
      input("streaming-control", [
        { id: "u1", role: "user", content: "Show a pie chart" },
      ]),
    );
    expect(
      result.events.filter((event) => event.type === "TOOL_CALL_ARGS"),
    ).toHaveLength(2);
    expect(retainedCalls(result.messages)).toEqual([calls[2]]);
  });

  it("retains the mixed batch through frontend pause, cold continuation and native restore", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    vi.stubEnv("MODEL_PROVIDER", "openai");
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      requests.push(String(init?.body));
      return providerResponse(
        String(url).includes("/responses"),
        requests.length > 1,
      );
    });
    const dir = await mkdtemp(join(tmpdir(), "strands-parallel-provider-"));
    const manager = new SessionManager({
      sessionId: "parallel",
      storage: { snapshot: new FileStorage(dir) },
    });
    try {
      const agent = await buildRichChatAgent();
      agent.config.sessionManagerProvider = () => manager;
      const first = await collect(
        agent,
        input("parallel", [
          {
            id: "u1",
            role: "user",
            content: "Enable app mode, create a todo and show a pie chart.",
          },
        ]),
      );
      expect(requests).toHaveLength(1); // Frontend pause must not enter another model cycle.
      expect(
        first.events
          .filter((e): e is ToolCallStartEvent => e.type === "TOOL_CALL_START")
          .map((e) => e.toolCallId),
      ).toEqual(calls.map((c) => c.id));
      expect(retainedCalls(first.messages)).toEqual(calls);
      const restored = new Agent({
        model: await createModel(),
        printer: false,
      });
      expect(await manager.restoreSnapshot({ target: restored })).toBe(true);
      expect(
        restored.messages
          .flatMap((m) => m.content)
          .filter((b) => b.type === "toolUseBlock")
          .map((b) => ({ id: b.toolUseId, name: b.name, args: b.input })),
      ).toEqual(calls);
      const todos = restored.appState.get("todos");
      const cold = await buildRichChatAgent();
      cold.config.sessionManagerProvider = () => manager;
      const continued = await collect(
        cold,
        input("parallel", [
          ...first.messages,
          {
            id: "result_mode",
            role: "tool",
            toolCallId: "call_mode",
            content: "App mode enabled",
          },
          {
            id: "result_chart",
            role: "tool",
            toolCallId: "call_chart",
            content: "Chart rendered",
          },
        ]),
      );
      expect(requests).toHaveLength(2);
      for (const call of calls) expect(requests[1]).toContain(call.id);
      expect(retainedCalls(continued.messages)).toEqual(calls);
      expect(
        continued.events.filter((e) => e.type === "TOOL_CALL_START"),
      ).toEqual([]);
      expect(await manager.restoreSnapshot({ target: restored })).toBe(true);
      expect(restored.appState.get("todos")).toEqual(todos);
      const expectedResults = [
        { id: "call_chart", content: "Chart rendered" },
        { id: "call_mode", content: "App mode enabled" },
        {
          id: "call_todo",
          content: "Sales todos updated. Tracking 1 item(s).",
        },
      ];
      expect(
        continued.messages
          .filter((message) => message.role === "tool")
          .map((message) => ({
            id: message.toolCallId,
            content:
              message.toolCallId === "call_todo" &&
              typeof message.content === "string"
                ? JSON.parse(message.content)
                : message.content,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(expectedResults);
      expect(
        restored.messages
          .flatMap((message) => message.content)
          .filter((block) => block.type === "toolResultBlock")
          .map((block) => ({
            id: block.toolUseId,
            content: block.content
              .map((part) =>
                part.type === "textBlock"
                  ? part.text
                  : part.type === "jsonBlock"
                    ? JSON.stringify(part.json)
                    : part,
              )
              .join(""),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(expectedResults);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
