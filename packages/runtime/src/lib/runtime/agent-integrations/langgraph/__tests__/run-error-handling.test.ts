import { Subscriber } from "rxjs";
import { EventType, RunAgentInput } from "@ag-ui/client";
import { ProcessedEvents } from "@ag-ui/langgraph";
import { LangGraphAgent } from "../agent";
import { LangGraphEventTypes } from "../../../../../agents/langgraph/events";

function createAgent() {
  return new LangGraphAgent({
    graphId: "test-graph",
    url: "http://localhost:8000",
  });
}

function makeRunInput(overrides?: Partial<RunAgentInput>): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    ...overrides,
  } as RunAgentInput;
}

/**
 * Subscribe to the agent's run() Observable and collect events / errors.
 */
function collectRunOutput(agent: LangGraphAgent, input: RunAgentInput) {
  const events: any[] = [];
  return new Promise<{ events: any[]; error: unknown | null }>((resolve) => {
    agent.run(input).subscribe({
      next: (e) => events.push(e),
      error: (err: unknown) => resolve({ events, error: err }),
      complete: () => resolve({ events, error: null }),
    });
  });
}

describe("run() async error handling", () => {
  it("routes a rejected runAgentStream promise to the Observable error channel", async () => {
    const agent = createAgent();
    const rejection = new Error("LangGraph connection refused");

    // Mock runAgentStream to reject — this is the scenario that previously
    // caused an unhandled promise rejection and crashed the process.
    vi.spyOn(agent, "runAgentStream").mockRejectedValue(rejection);

    const { events, error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBe(rejection);
    expect(events).toHaveLength(0);
  });

  it("routes a thrown error in runAgentStream to the Observable error channel", async () => {
    const agent = createAgent();
    const thrown = new Error("unexpected failure in stream");

    vi.spyOn(agent, "runAgentStream").mockImplementation(async () => {
      throw thrown;
    });

    const { events, error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBe(thrown);
    expect(events).toHaveLength(0);
  });

  it("routes non-Error rejections to the Observable error channel", async () => {
    const agent = createAgent();

    vi.spyOn(agent, "runAgentStream").mockRejectedValue("string rejection");

    const { error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBe("string rejection");
  });

  it("emits events normally when runAgentStream succeeds", async () => {
    const agent = createAgent();

    vi.spyOn(agent, "runAgentStream").mockImplementation(
      async (_input: any, subscriber: Subscriber<ProcessedEvents>) => {
        subscriber.next({
          type: EventType.TEXT_MESSAGE_START,
          role: "assistant",
          messageId: "msg-1",
        } as any);
        subscriber.next({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "hello",
        } as any);
        subscriber.next({
          type: EventType.TEXT_MESSAGE_END,
          messageId: "msg-1",
        } as any);
        subscriber.complete();
      },
    );

    const { events, error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBeNull();
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe(EventType.TEXT_MESSAGE_START);
    expect(events[1].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
    expect(events[2].type).toBe(EventType.TEXT_MESSAGE_END);
  });

  it("emits events received before an async rejection", async () => {
    const agent = createAgent();

    vi.spyOn(agent, "runAgentStream").mockImplementation(
      async (_input: any, subscriber: Subscriber<ProcessedEvents>) => {
        subscriber.next({
          type: EventType.TEXT_MESSAGE_START,
          role: "assistant",
          messageId: "msg-1",
        } as any);
        throw new Error("mid-stream failure");
      },
    );

    const { events, error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("mid-stream failure");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EventType.TEXT_MESSAGE_START);
  });

  it("transforms RAW events through the map pipe after safe wrapping", async () => {
    const agent = createAgent();
    const predictStateMetadata = [{ tool: "predict_tool", stateKey: "key" }];

    vi.spyOn(agent, "runAgentStream").mockImplementation(
      async (_input: any, subscriber: Subscriber<ProcessedEvents>) => {
        subscriber.next({
          type: EventType.RAW,
          event: {
            event: LangGraphEventTypes.OnChatModelStream,
            data: {
              chunk: {
                tool_call_chunks: [{ name: "predict_tool" }],
              },
            },
            metadata: {
              "copilotkit:emit-intermediate-state": predictStateMetadata,
            },
          },
        } as any);
        subscriber.complete();
      },
    );

    const { events, error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EventType.CUSTOM);
    expect(events[0].name).toBe("PredictState");
    expect(events[0].value).toBe(predictStateMetadata);
  });

  it("passes through non-RAW events unchanged", async () => {
    const agent = createAgent();

    const stateSnapshot = {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { values: { foo: "bar" } },
    };

    vi.spyOn(agent, "runAgentStream").mockImplementation(
      async (_input: any, subscriber: Subscriber<ProcessedEvents>) => {
        subscriber.next(stateSnapshot as any);
        subscriber.complete();
      },
    );

    const { events, error } = await collectRunOutput(agent, makeRunInput());

    expect(error).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(stateSnapshot);
  });
});
