import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { from, firstValueFrom, toArray } from "rxjs";
import { OpenGenerativeUIMiddleware } from "./open-generative-ui-middleware";
import { A2UIV09BridgeMiddleware } from "../generative-ui/a2ui-v09-middleware";
import { transformRecordedEvents } from "./recorded-events";

const input: RunAgentInput = {
  threadId: "thread",
  runId: "run",
  messages: [],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
};

function toolRun(name: string, args: string): BaseEvent[] {
  return [
    { type: EventType.RUN_STARTED, threadId: "thread", runId: "run" },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: "call",
      toolCallName: name,
      parentMessageId: "message",
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "call", delta: args },
    { type: EventType.TOOL_CALL_END, toolCallId: "call" },
    {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "call",
      messageId: "result",
      content: "done",
    },
    { type: EventType.RUN_FINISHED, threadId: "thread", runId: "run" },
  ];
}

class ScriptedAgent extends AbstractAgent {
  constructor(private readonly events: BaseEvent[]) {
    super();
  }
  run() {
    return from(this.events);
  }
  clone() {
    return new ScriptedAgent(this.events);
  }
}

describe("transformRecordedEvents", () => {
  it("retains pending tool calls from the recorded input history", async () => {
    const resumed: RunAgentInput = {
      ...input,
      messages: [
        {
          id: "prior",
          role: "assistant",
          toolCalls: [
            {
              id: "pending",
              type: "function",
              function: { name: "render_a2ui", arguments: "{}" },
            },
          ],
        },
      ],
    };
    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId: "thread", runId: "run" },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "new",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "new",
        delta: "Hello",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "new" },
      { type: EventType.RUN_FINISHED, threadId: "thread", runId: "run" },
    ];
    const output = await transformRecordedEvents(resumed, events, {
      a2ui: {},
      openGenerativeUI: true,
    });
    // A2UI cancels a render left unanswered by an earlier run. Its "failed"
    // lifecycle snapshot names no surface, so the v0.9 bridge consumes it:
    // the 1.0 client renders no `a2ui-surface` activity.
    expect(output).toEqual([
      events[0],
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "pending",
        content: expect.stringContaining('"status":"cancelled"'),
      }),
      ...events.slice(1),
    ]);
  });
  it("matches the live middleware chain event-for-event without changing its input", async () => {
    const events = toolRun(
      "generateSandboxedUi",
      JSON.stringify({ initialHeight: 200, html: "<p>Hello</p>" }),
    );
    const original = structuredClone(events);
    const live = new ScriptedAgent(events);
    live.use(
      new A2UIV09BridgeMiddleware(),
      new A2UIMiddleware({}),
      new OpenGenerativeUIMiddleware(),
    );
    const expected: BaseEvent[] = [];
    await live.runAgent(
      { runId: input.runId },
      {
        onEvent: ({ event }) => {
          expected.push(event);
        },
      },
    );
    const actual = await transformRecordedEvents(input, events, {
      a2ui: {},
      openGenerativeUI: true,
    });
    expect(actual).toEqual(expected);
    expect(
      actual.filter((event) => event.type === EventType.ACTIVITY_SNAPSHOT),
    ).toEqual([
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "call-activity",
        activityType: "open-generative-ui",
        content: { initialHeight: 200, generating: true },
      },
    ]);
    expect(events).toEqual(original);
  });

  it("converts the A2UI surfaces to 1.0 and respects catalog configuration", async () => {
    const events = toolRun(
      "render_a2ui",
      JSON.stringify({
        surfaceId: "surface",
        components: [{ id: "root", component: "Text", text: "Hello" }],
      }),
    );
    const config = { defaultCatalogId: "test://catalog" };
    const expected = await firstValueFrom(
      new A2UIV09BridgeMiddleware()
        .run(input, {
          run: (runInput: RunAgentInput) =>
            new A2UIMiddleware(config).run(runInput, new ScriptedAgent(events)),
        } as AbstractAgent)
        .pipe(toArray()),
    );
    const actual = await transformRecordedEvents(input, events, {
      a2ui: config,
    });
    expect(actual).toEqual(expected);
    const surfaces = actual.filter(
      (event) => event.type === EventType.ACTIVITY_SNAPSHOT,
    );
    expect(surfaces).toEqual([
      expect.objectContaining({
        messageId: "genui:surface",
        activityType: "generative-ui-surface",
        content: expect.objectContaining({
          surfaceId: "surface",
          catalogId: "test://catalog",
          a2uiSourceVersion: "0.9",
        }),
      }),
    ]);
  });

  it("replays the recording once when A2UI answers a render call from it", async () => {
    const events = toolRun(
      "render_a2ui",
      JSON.stringify({
        surfaceId: "surface",
        components: [{ id: "root", component: "Text", text: "Hello" }],
      }),
    ).filter((event) => event.type !== EventType.TOOL_CALL_RESULT);
    const output = await transformRecordedEvents(input, events, {
      a2ui: {},
      openGenerativeUI: true,
    });
    for (const type of [EventType.RUN_STARTED, EventType.TOOL_CALL_START]) {
      expect(output.filter((event) => event.type === type)).toHaveLength(1);
    }
    expect(output.slice(-2)).toEqual([
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call",
        content: '{"status":"rendered"}',
      }),
      events.at(-1),
    ]);
  });

  it("passes ordinary events and terminal errors through unchanged", async () => {
    const events: BaseEvent[] = [
      { type: EventType.RUN_ERROR, message: "recorded failure" },
    ];
    expect(
      await transformRecordedEvents(input, events, {
        a2ui: {},
        openGenerativeUI: true,
      }),
    ).toEqual(events);
    expect(await transformRecordedEvents(input, [], {})).toEqual([]);
  });
});
