import { describe, it, expect } from "vitest";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
  Tool,
  ToolCallResultEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
} from "@ag-ui/client";
import { Observable, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import {
  OpenGenerativeUIMiddleware,
  ArgsParser,
} from "../open-generative-ui-middleware";

/**
 * A minimal agent that records the input it receives and emits scripted events.
 */
class MockAgent extends AbstractAgent {
  public receivedInput: RunAgentInput | null = null;

  constructor(private readonly events: BaseEvent[]) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.receivedInput = input;
    return new Observable<BaseEvent>((subscriber) => {
      for (const event of this.events) {
        subscriber.next(event);
      }
      subscriber.complete();
    });
  }

  clone(): AbstractAgent {
    return new MockAgent([...this.events]);
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    throw new Error("not used");
  }
}

function createRunInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: undefined,
    ...overrides,
  };
}

async function collectEvents(observable: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return firstValueFrom(observable.pipe(toArray()));
}

describe("OpenGenerativeUIMiddleware e2e", () => {
  describe("Tool injection", () => {
    it("injects the generate_sandboxed_ui tool into the agent input", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const agent = new MockAgent([
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
      ]);

      await collectEvents(middleware.run(createRunInput(), agent));

      const tools = agent.receivedInput!.tools;
      const injectedTool = tools.find((t: Tool) => t.name === "generate_sandboxed_ui");
      expect(injectedTool).toBeDefined();
      expect(injectedTool!.parameters).toEqual({
        type: "object",
        properties: {
          height: { type: "number", description: expect.any(String) },
          html: { type: "string", description: expect.any(String) },
          js_functions: { type: "string", description: expect.any(String) },
          js_expressions: {
            type: "array",
            items: { type: "string" },
            description: expect.any(String),
          },
        },
      });
    });

    it("does not duplicate the tool if it already exists in input", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const existingTool: Tool = {
        name: "generate_sandboxed_ui",
        description: "old",
        parameters: { type: "object", properties: {} },
      };
      const agent = new MockAgent([
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
      ]);

      await collectEvents(middleware.run(createRunInput({ tools: [existingTool] }), agent));

      const tools = agent.receivedInput!.tools;
      const matchingTools = tools.filter((t: Tool) => t.name === "generate_sandboxed_ui");
      expect(matchingTools).toHaveLength(1);
    });
  });

  describe("Tool result injection", () => {
    it("adds a TOOL_CALL_RESULT with 'UI generated' for pending generate_sandboxed_ui calls", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-1";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
        // Assistant message with a tool call
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: parentMessageId,
          role: "assistant",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: parentMessageId,
        } as BaseEvent,
        // Tool call for generate_sandboxed_ui — no TOOL_CALL_RESULT
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: "generate_sandboxed_ui",
          parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: "{}",
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
      ]);

      const events = await collectEvents(middleware.run(createRunInput(), agent));

      // Find the injected TOOL_CALL_RESULT
      const toolResults = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      ) as ToolCallResultEvent[];
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].toolCallId).toBe(toolCallId);
      expect(toolResults[0].content).toBe("UI generated");

      // TOOL_CALL_RESULT should appear before RUN_FINISHED
      const resultIndex = events.indexOf(toolResults[0]);
      const finishedIndex = events.findIndex((e) => e.type === EventType.RUN_FINISHED);
      expect(resultIndex).toBeLessThan(finishedIndex);
    });

    it("does not inject a result for non-generate_sandboxed_ui tool calls", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-other";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: parentMessageId,
          role: "assistant",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: "some_other_tool",
          parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: "{}",
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
      ]);

      const events = await collectEvents(middleware.run(createRunInput(), agent));

      const toolResults = events.filter((e) => e.type === EventType.TOOL_CALL_RESULT);
      expect(toolResults).toHaveLength(0);
    });

    it("does not inject a result if the tool call already has one", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-resolved";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: parentMessageId,
          role: "assistant",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: "generate_sandboxed_ui",
          parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: "{}",
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent,
        // Agent already provides the result
        {
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: "result-msg",
          content: "already resolved",
        } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
      ]);

      const events = await collectEvents(middleware.run(createRunInput(), agent));

      const toolResults = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      ) as ToolCallResultEvent[];
      // Only the agent's own result — no injected one
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].content).toBe("already resolved");
    });
  });

  describe("ArgsParser (streaming JSON via clarinet)", () => {
    const noop = () => {};

    it("parses a complete JSON object in one chunk", () => {
      const parser = new ArgsParser("tc-1", noop);
      parser.write('{"height":400,"html":"<div>hi</div>","js_functions":"function foo(){}","js_expressions":["expr1","expr2"]}');

      expect(parser.params).toEqual({
        height: 400,
        html: "<div>hi</div>",
        js_functions: "function foo(){}",
        js_expressions: ["expr1", "expr2"],
      });
    });

    it("parses JSON streamed in small chunks", () => {
      const parser = new ArgsParser("tc-1", noop);
      const json = '{"height":300,"html":"<p>hello</p>"}';

      for (const ch of json) {
        parser.write(ch);
      }

      expect(parser.params.height).toBe(300);
      expect(parser.params.html).toBe("<p>hello</p>");
    });

    it("parses js_expressions array streamed incrementally", () => {
      const parser = new ArgsParser("tc-1", noop);

      parser.write('{"js_expressions":');
      expect(parser.params.js_expressions).toBeUndefined();

      parser.write('["alert(1)",');
      expect(parser.params.js_expressions).toEqual(["alert(1)"]);

      parser.write('"console.log(2)",');
      expect(parser.params.js_expressions).toEqual(["alert(1)", "console.log(2)"]);

      parser.write('"document.title"]}');
      expect(parser.params.js_expressions).toEqual([
        "alert(1)",
        "console.log(2)",
        "document.title",
      ]);
    });

    it("handles partial chunks that split across keys and values", () => {
      const parser = new ArgsParser("tc-1", noop);

      parser.write('{"hei');
      parser.write('ght":');
      parser.write("25");
      parser.write('0,"ht');
      parser.write('ml":"<div');
      parser.write('>test</div>"}');

      expect(parser.params.height).toBe(250);
      expect(parser.params.html).toBe("<div>test</div>");
    });

    it("ignores unknown keys", () => {
      const parser = new ArgsParser("tc-1", noop);
      parser.write('{"height":100,"unknown_field":"ignored","html":"ok"}');

      expect(parser.params.height).toBe(100);
      expect(parser.params.html).toBe("ok");
      expect(parser.params).not.toHaveProperty("unknown_field");
    });
  });

  describe("Activity event emission", () => {
    it("emits ACTIVITY_SNAPSHOT when height finishes", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"height":400}');

      expect(emitted).toHaveLength(1);
      const snapshot = emitted[0] as ActivitySnapshotEvent;
      expect(snapshot.type).toBe(EventType.ACTIVITY_SNAPSHOT);
      expect(snapshot.messageId).toBe("tc-1-activity");
      expect(snapshot.activityType).toBe("open-generative-ui");
      expect(snapshot.content).toEqual({ height: 400 });
    });

    it("emits ACTIVITY_DELTA for html and js_functions", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"height":200,');
      emitted.length = 0; // clear snapshot

      parser.write('"html":"<div/>",');
      expect(emitted).toHaveLength(1);
      const htmlDelta = emitted[0] as ActivityDeltaEvent;
      expect(htmlDelta.type).toBe(EventType.ACTIVITY_DELTA);
      expect(htmlDelta.messageId).toBe("tc-1-activity");
      expect(htmlDelta.patch).toEqual([
        { op: "replace", path: "/html", value: "<div/>" },
      ]);

      emitted.length = 0;
      parser.write('"js_functions":"fn(){}"}');
      expect(emitted).toHaveLength(1);
      const fnDelta = emitted[0] as ActivityDeltaEvent;
      expect(fnDelta.patch).toEqual([
        { op: "replace", path: "/js_functions", value: "fn(){}" },
      ]);
    });

    it("emits ACTIVITY_DELTA with add op for each js_expressions item", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"height":100,');
      emitted.length = 0; // clear snapshot

      parser.write('"js_expressions":["expr1",');
      expect(emitted).toHaveLength(1);
      const delta1 = emitted[0] as ActivityDeltaEvent;
      expect(delta1.type).toBe(EventType.ACTIVITY_DELTA);
      expect(delta1.patch).toEqual([
        { op: "add", path: "/js_expressions/-", value: "expr1" },
      ]);

      emitted.length = 0;
      parser.write('"expr2",');
      expect(emitted).toHaveLength(1);
      const delta2 = emitted[0] as ActivityDeltaEvent;
      expect(delta2.patch).toEqual([
        { op: "add", path: "/js_expressions/-", value: "expr2" },
      ]);

      emitted.length = 0;
      parser.write('"expr3"]}');
      expect(emitted).toHaveLength(1);
      const delta3 = emitted[0] as ActivityDeltaEvent;
      expect(delta3.patch).toEqual([
        { op: "add", path: "/js_expressions/-", value: "expr3" },
      ]);
    });

    it("emits snapshot only once even with multiple params", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"height":100,"html":"a","js_functions":"b"}');

      const snapshots = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      );
      expect(snapshots).toHaveLength(1);
    });

    it("emits activity events through the middleware stream", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-stream";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: parentMessageId,
          role: "assistant",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: "generate_sandboxed_ui",
          parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '{"height":300,',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '"html":"<p>hi</p>"}',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" } as BaseEvent,
      ]);

      const events = await collectEvents(middleware.run(createRunInput(), agent));

      const snapshots = events.filter(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      ) as ActivitySnapshotEvent[];
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].messageId).toBe(`${toolCallId}-activity`);
      expect(snapshots[0].content).toEqual({ height: 300 });

      const deltas = events.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      expect(deltas).toHaveLength(1);
      expect(deltas[0].patch).toEqual([
        { op: "replace", path: "/html", value: "<p>hi</p>" },
      ]);

      // Activity events should appear after the TOOL_CALL_ARGS that triggered them
      const firstArgsIdx = events.findIndex(
        (e) => e.type === EventType.TOOL_CALL_ARGS,
      );
      const snapshotIdx = events.indexOf(snapshots[0]);
      expect(snapshotIdx).toBeGreaterThan(firstArgsIdx);
    });
  });
});
