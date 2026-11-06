import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { from, firstValueFrom, toArray } from "rxjs";
import { OpenGenerativeUIMiddleware } from "./open-generative-ui-middleware";
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
    expect(output).toEqual([
      ...events.slice(0, -1),
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "pending",
        content: '{"status":"rendered"}',
      }),
      events.at(-1),
    ]);
  });
  it("matches the live middleware chain event-for-event without changing its input", async () => {
    const events = toolRun(
      "generateSandboxedUi",
      JSON.stringify({ initialHeight: 200, html: "<p>Hello</p>" }),
    );
    const original = structuredClone(events);
    const live = new ScriptedAgent(events);
    live.use(new A2UIMiddleware({}), new OpenGenerativeUIMiddleware());
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

  it("uses the existing A2UI converter and respects catalog configuration", async () => {
    const events = toolRun(
      "render_a2ui",
      JSON.stringify({
        surfaceId: "surface",
        components: [{ id: "root", component: "Text", text: "Hello" }],
      }),
    );
    const config = { defaultCatalogId: "test://catalog" };
    const expected = await firstValueFrom(
      new A2UIMiddleware(config)
        .run(input, new ScriptedAgent(events))
        .pipe(toArray()),
    );
    const actual = await transformRecordedEvents(input, events, {
      a2ui: config,
    });
    expect(actual).toEqual(expected);
    expect(JSON.stringify(actual)).toContain("test://catalog");
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
