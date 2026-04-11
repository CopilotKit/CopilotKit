import { describe, it, expect } from "vitest";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
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

async function collectEvents(
  observable: Observable<BaseEvent>,
): Promise<BaseEvent[]> {
  return firstValueFrom(observable.pipe(toArray()));
}

describe("OpenGenerativeUIMiddleware e2e", () => {
  describe("Tool passthrough", () => {
    it("does not modify the tools list", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const agent = new MockAgent([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
      ]);

      const input = createRunInput();
      await collectEvents(middleware.run(input, agent));

      expect(agent.receivedInput!.tools).toEqual(input.tools);
    });
  });

  describe("ArgsParser (streaming JSON via clarinet)", () => {
    const noop = () => {};

    it("parses a complete JSON object in one chunk", () => {
      const parser = new ArgsParser("tc-1", noop);
      parser.write(
        '{"initialHeight":400,"html":"<div>hi</div>","jsFunctions":"function foo(){}","jsExpressions":["expr1","expr2"]}',
      );

      expect(parser.params).toEqual({
        initialHeight: 400,
        html: "<div>hi</div>",
        jsFunctions: "function foo(){}",
        jsExpressions: ["expr1", "expr2"],
      });
    });

    it("streams html as incremental chunks via textNode", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":200,');
      emitted.length = 0; // clear snapshot

      // Start streaming html — first chunk
      parser.write('"html":"<div');
      const htmlDeltas1 = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      // Should have array creation + first chunk
      expect(htmlDeltas1.length).toBeGreaterThanOrEqual(1);
      expect(htmlDeltas1[0].patch).toEqual([
        { op: "add", path: "/html", value: [] },
      ]);

      emitted.length = 0;
      // More html content — note: clarinet needs a delimiter after the
      // closing quote to emit onvalue, so include the trailing }
      parser.write('>hello</div>"}');
      // Should have more chunk(s) + htmlComplete
      const completeDelta = emitted.find(
        (e) =>
          e.type === EventType.ACTIVITY_DELTA &&
          (e as ActivityDeltaEvent).patch.some(
            (p) => p.path === "/htmlComplete",
          ),
      );
      expect(completeDelta).toBeDefined();

      // Final params should have the complete html
      expect(parser.params.html).toBe("<div>hello</div>");
    });

    it("parses JSON streamed in small chunks", () => {
      const parser = new ArgsParser("tc-1", noop);
      const json = '{"initialHeight":300,"html":"<p>hello</p>"}';

      for (const ch of json) {
        parser.write(ch);
      }

      expect(parser.params.initialHeight).toBe(300);
      expect(parser.params.html).toBe("<p>hello</p>");
    });

    it("parses jsExpressions array streamed incrementally", () => {
      const parser = new ArgsParser("tc-1", noop);

      parser.write('{"jsExpressions":');
      expect(parser.params.jsExpressions).toBeUndefined();

      parser.write('["alert(1)",');
      expect(parser.params.jsExpressions).toEqual(["alert(1)"]);

      parser.write('"console.log(2)",');
      expect(parser.params.jsExpressions).toEqual([
        "alert(1)",
        "console.log(2)",
      ]);

      parser.write('"document.title"]}');
      expect(parser.params.jsExpressions).toEqual([
        "alert(1)",
        "console.log(2)",
        "document.title",
      ]);
    });

    it("handles partial chunks that split across keys and values", () => {
      const parser = new ArgsParser("tc-1", noop);

      parser.write('{"ini');
      parser.write('tialHeight":');
      parser.write("25");
      parser.write('0,"ht');
      parser.write('ml":"<div');
      parser.write('>test</div>"}');

      expect(parser.params.initialHeight).toBe(250);
      expect(parser.params.html).toBe("<div>test</div>");
    });

    it("ignores unknown keys", () => {
      const parser = new ArgsParser("tc-1", noop);
      parser.write(
        '{"initialHeight":100,"unknown_field":"ignored","html":"ok"}',
      );

      expect(parser.params.initialHeight).toBe(100);
      expect(parser.params.html).toBe("ok");
      expect(parser.params).not.toHaveProperty("unknown_field");
    });
  });

  describe("Activity event emission", () => {
    it("emits ACTIVITY_SNAPSHOT when initialHeight finishes", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":400}');

      expect(emitted).toHaveLength(1);
      const snapshot = emitted[0] as ActivitySnapshotEvent;
      expect(snapshot.type).toBe(EventType.ACTIVITY_SNAPSHOT);
      expect(snapshot.messageId).toBe("tc-1-activity");
      expect(snapshot.activityType).toBe("open-generative-ui");
      expect(snapshot.content).toEqual({
        initialHeight: 400,
        generating: true,
      });
    });

    it("emits ACTIVITY_DELTA array for html and single delta for jsFunctions", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":200,');
      emitted.length = 0; // clear snapshot

      parser.write('"html":"<div/>",');
      // Should have: array creation, chunk(s), htmlComplete
      const htmlDeltas = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      expect(htmlDeltas[0].patch).toEqual([
        { op: "add", path: "/html", value: [] },
      ]);
      // Last html delta should be htmlComplete
      const completeIdx = htmlDeltas.findIndex((d) =>
        d.patch.some((p) => p.path === "/htmlComplete"),
      );
      expect(completeIdx).toBeGreaterThan(0);

      emitted.length = 0;
      parser.write('"jsFunctions":"fn(){}"}');
      const fnDeltas = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      expect(fnDeltas).toHaveLength(2);
      expect(fnDeltas[0].patch).toEqual([
        { op: "add", path: "/jsFunctions", value: "fn(){}" },
      ]);
      expect(fnDeltas[1].patch).toEqual([
        { op: "add", path: "/jsFunctionsComplete", value: true },
      ]);
    });

    it("emits ACTIVITY_DELTA with add op for each jsExpressions item", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":100,');
      emitted.length = 0; // clear snapshot

      parser.write('"jsExpressions":["expr1",');
      // First: array-creation delta, then the first item append
      expect(emitted).toHaveLength(2);
      const arrayCreate = emitted[0] as ActivityDeltaEvent;
      expect(arrayCreate.type).toBe(EventType.ACTIVITY_DELTA);
      expect(arrayCreate.patch).toEqual([
        { op: "add", path: "/jsExpressions", value: [] },
      ]);
      const delta1 = emitted[1] as ActivityDeltaEvent;
      expect(delta1.type).toBe(EventType.ACTIVITY_DELTA);
      expect(delta1.patch).toEqual([
        { op: "add", path: "/jsExpressions/-", value: "expr1" },
      ]);

      emitted.length = 0;
      parser.write('"expr2",');
      expect(emitted).toHaveLength(1);
      const delta2 = emitted[0] as ActivityDeltaEvent;
      expect(delta2.patch).toEqual([
        { op: "add", path: "/jsExpressions/-", value: "expr2" },
      ]);

      emitted.length = 0;
      parser.write('"expr3"]}');
      expect(emitted).toHaveLength(2);
      const delta3 = emitted[0] as ActivityDeltaEvent;
      expect(delta3.patch).toEqual([
        { op: "add", path: "/jsExpressions/-", value: "expr3" },
      ]);
      expect((emitted[1] as ActivityDeltaEvent).patch).toEqual([
        { op: "add", path: "/jsExpressionsComplete", value: true },
      ]);
    });

    it("emits html chunks immediately without throttling", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":200,');
      emitted.length = 0;

      // Start html streaming — first write should emit
      parser.write('"html":"chunk1');
      const firstDeltas = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      // Should have array creation + first chunk
      expect(firstDeltas.length).toBeGreaterThanOrEqual(1);

      // Immediate second write should also emit (no throttle)
      emitted.length = 0;
      parser.write("chunk2");
      const secondDeltas = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      expect(secondDeltas).toHaveLength(1);
      expect(secondDeltas[0].patch[0].value).toContain("chunk2");

      // Completing the html string should flush remaining + htmlComplete
      emitted.length = 0;
      parser.write('",');
      const completeDeltas = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      const completeDelta = completeDeltas.find((d) =>
        d.patch.some((p) => p.path === "/htmlComplete"),
      );
      expect(completeDelta).toBeDefined();
    });

    it("emits snapshot only once even with multiple params", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":100,"html":"a","jsFunctions":"b"}');

      const snapshots = emitted.filter(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      );
      expect(snapshots).toHaveLength(1);
    });

    it("produces patches that build complete content when applied sequentially", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      // Simulate a full tool call with all parameter types
      parser.write(
        '{"initialHeight":400,"html":"<body>game</body>","jsFunctions":"function init(){}","jsExpressions":["init()","update()"]}',
      );

      // Reconstruct content by applying snapshot + deltas in order
      let content: Record<string, unknown> = {};
      for (const event of emitted) {
        if (event.type === EventType.ACTIVITY_SNAPSHOT) {
          content = { ...(event as ActivitySnapshotEvent).content } as Record<
            string,
            unknown
          >;
        } else if (event.type === EventType.ACTIVITY_DELTA) {
          const delta = event as ActivityDeltaEvent;
          for (const op of delta.patch) {
            if (op.op === "add") {
              if (op.path.endsWith("/-")) {
                // Array append: path like "/jsExpressions/-" or "/html/-"
                const arrayKey = op.path.slice(1, -2);
                (content[arrayKey] as unknown[]).push(op.value);
              } else {
                // Direct property: path like "/htmlComplete"
                content[op.path.slice(1)] = op.value;
              }
            }
          }
        }
      }

      // html is now an array of chunks; join to verify full content
      expect(Array.isArray(content.html)).toBe(true);
      expect((content.html as string[]).join("")).toBe("<body>game</body>");
      expect(content.htmlComplete).toBe(true);
      expect(content.jsFunctions).toBe("function init(){}");
      expect(content.jsExpressions).toEqual(["init()", "update()"]);
    });

    it("produces patches that build content correctly when streamed in chunks", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      // Stream in small chunks like a real LLM would
      parser.write('{"initialHeight":300,');
      parser.write('"html":"<div>hi</div>",');
      parser.write('"jsFunctions":"function go(){}",');
      parser.write('"jsExpressions":["go()",');
      parser.write('"render()","done()"]}');

      // Reconstruct content
      let content: Record<string, unknown> = {};
      for (const event of emitted) {
        if (event.type === EventType.ACTIVITY_SNAPSHOT) {
          content = { ...(event as ActivitySnapshotEvent).content } as Record<
            string,
            unknown
          >;
        } else if (event.type === EventType.ACTIVITY_DELTA) {
          const delta = event as ActivityDeltaEvent;
          for (const op of delta.patch) {
            if (op.op === "add") {
              if (op.path.endsWith("/-")) {
                const arrayKey = op.path.slice(1, -2);
                (content[arrayKey] as unknown[]).push(op.value);
              } else {
                content[op.path.slice(1)] = op.value;
              }
            }
          }
        }
      }

      // html is now an array of chunks
      expect(Array.isArray(content.html)).toBe(true);
      expect((content.html as string[]).join("")).toBe("<div>hi</div>");
      expect(content.htmlComplete).toBe(true);
      expect(content.jsFunctions).toBe("function go(){}");
      expect(content.jsExpressions).toEqual(["go()", "render()", "done()"]);
    });

    it("emits array-creation delta before first jsExpressions item", () => {
      const emitted: BaseEvent[] = [];
      const parser = new ArgsParser("tc-1", (e) => emitted.push(e));

      parser.write('{"initialHeight":100,');
      emitted.length = 0; // clear snapshot

      // Trailing comma needed — clarinet fires onvalue after a delimiter
      parser.write('"jsExpressions":["first",');

      // Should get array creation delta followed by item delta
      expect(emitted).toHaveLength(2);
      expect((emitted[0] as ActivityDeltaEvent).patch).toEqual([
        { op: "add", path: "/jsExpressions", value: [] },
      ]);
      expect((emitted[1] as ActivityDeltaEvent).patch).toEqual([
        { op: "add", path: "/jsExpressions/-", value: "first" },
      ]);
    });

    it("holds genui tool call events and flushes after first activity event", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-stream";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
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
          toolCallName: "generateSandboxedUi",
          parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '{"initialHeight":300,',
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
        {
          type: EventType.RUN_FINISHED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
      ]);

      const events = await collectEvents(
        middleware.run(createRunInput(), agent),
      );

      // ACTIVITY_SNAPSHOT should appear before any tool call events
      const snapshotIdx = events.findIndex(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      );
      const toolCallStartIdx = events.findIndex(
        (e) => e.type === EventType.TOOL_CALL_START,
      );
      expect(snapshotIdx).toBeGreaterThan(-1);
      expect(toolCallStartIdx).toBeGreaterThan(-1);
      expect(snapshotIdx).toBeLessThan(toolCallStartIdx);

      // Activity content is correct
      const snapshots = events.filter(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      ) as ActivitySnapshotEvent[];
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].content).toEqual({
        initialHeight: 300,
        generating: true,
      });

      const deltas = events.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];
      // html deltas: array creation, chunk(s), htmlComplete, then generating: false
      expect(deltas.length).toBeGreaterThanOrEqual(3);
      expect(deltas[0].patch).toEqual([
        { op: "add", path: "/html", value: [] },
      ]);
      // Last delta should be generating: false
      expect(deltas[deltas.length - 1].patch).toEqual([
        { op: "add", path: "/generating", value: false },
      ]);
      // htmlComplete should be emitted
      const htmlCompleteDelta = deltas.find((d) =>
        d.patch.some((p) => p.path === "/htmlComplete" && p.value === true),
      );
      expect(htmlCompleteDelta).toBeDefined();
    });

    it("passes through tool call events for non-genui tools", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-other";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
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
        {
          type: EventType.RUN_FINISHED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
      ]);

      const events = await collectEvents(
        middleware.run(createRunInput(), agent),
      );

      const types = events.map((e) => e.type);
      expect(types).toEqual([
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_END,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.RUN_FINISHED,
      ]);
    });

    it("emits full activity events for jsFunctions and jsExpressions through middleware", async () => {
      const middleware = new OpenGenerativeUIMiddleware();
      const toolCallId = "tc-js";
      const parentMessageId = "msg-1";

      const agent = new MockAgent([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
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
          toolCallName: "generateSandboxedUi",
          parentMessageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '{"initialHeight":400,',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '"html":"<body>game</body>",',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '"jsFunctions":"function init(){}",',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '"jsExpressions":["init()",',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '"render()"]}',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent,
      ]);

      const events = await collectEvents(
        middleware.run(createRunInput(), agent),
      );

      // Verify snapshot
      const snapshots = events.filter(
        (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
      ) as ActivitySnapshotEvent[];
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].content).toEqual({
        initialHeight: 400,
        generating: true,
      });

      // Verify deltas
      const deltas = events.filter(
        (e) => e.type === EventType.ACTIVITY_DELTA,
      ) as ActivityDeltaEvent[];

      // html is now streamed as array: creation, chunk(s), htmlComplete
      // Then: jsFunctions, jsExpressions array creation, items, generating: false
      // Verify key structural deltas exist
      expect(deltas[0].patch).toEqual([
        { op: "add", path: "/html", value: [] },
      ]);
      const htmlCompleteDelta = deltas.find((d) =>
        d.patch.some((p) => p.path === "/htmlComplete" && p.value === true),
      );
      expect(htmlCompleteDelta).toBeDefined();
      const jsFuncDelta = deltas.find((d) =>
        d.patch.some((p) => p.path === "/jsFunctions"),
      );
      expect(jsFuncDelta).toBeDefined();
      expect(deltas[deltas.length - 1].patch).toEqual([
        { op: "add", path: "/generating", value: false },
      ]);

      // Reconstruct content to prove patches work end-to-end
      let content: Record<string, unknown> = {};
      for (const event of events) {
        if (event.type === EventType.ACTIVITY_SNAPSHOT) {
          content = { ...(event as ActivitySnapshotEvent).content } as Record<
            string,
            unknown
          >;
        } else if (event.type === EventType.ACTIVITY_DELTA) {
          for (const op of (event as ActivityDeltaEvent).patch) {
            if (op.op === "add") {
              if (op.path.endsWith("/-")) {
                const arrayKey = op.path.slice(1, -2);
                (content[arrayKey] as unknown[]).push(op.value);
              } else {
                content[op.path.slice(1)] = op.value;
              }
            }
          }
        }
      }

      // html is now an array of chunks
      expect(Array.isArray(content.html)).toBe(true);
      expect((content.html as string[]).join("")).toBe("<body>game</body>");
      expect(content.htmlComplete).toBe(true);
      expect(content.generating).toBe(false);
      expect(content.jsFunctions).toBe("function init(){}");
      expect(content.jsExpressions).toEqual(["init()", "render()"]);
    });
  });
});
