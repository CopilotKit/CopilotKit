import { vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { CopilotKitCore } from "@copilotkit/core";
import { Observable } from "rxjs";
import { useCoAgent } from "../use-coagent";

// A real agent and a real core, not mocks. Two bugs hid behind mocks (#3132):
// start/run/stop were returned as unbound prototype methods, which only fails
// when the method reads `this`, and they called the agent directly, which
// skipped everything the core adds to a run.
class RecordingAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  aborts = 0;
  /** When set, the first run calls this frontend tool. */
  toolCall: { name: string; args: string } | undefined;

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    const toolCall = this.inputs.length === 1 ? this.toolCall : undefined;
    return new Observable<BaseEvent>((subscriber) => {
      const { threadId, runId } = input;
      subscriber.next({ type: EventType.RUN_STARTED, threadId, runId });
      if (toolCall) {
        const toolCallId = "call-1";
        subscriber.next({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: toolCall.name,
          parentMessageId: "msg-1",
        } as BaseEvent);
        subscriber.next({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: toolCall.args,
        } as BaseEvent);
        subscriber.next({
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent);
      }
      subscriber.next({ type: EventType.RUN_FINISHED, threadId, runId });
      subscriber.complete();
    });
  }

  abortRun(): void {
    // `this` is undefined when the method is called unbound.
    this.aborts += 1;
  }
}

let agent: RecordingAgent;
let core: CopilotKitCore;

vi.mock("../../../v2", () => ({
  useAgent: vi.fn(() => ({ agent })),
  useCopilotKit: vi.fn(() => ({ copilotkit: core })),
}));

vi.mock("../use-copilot-chat_internal", () => ({
  useCopilotChat: () => ({
    appendMessage: vi.fn(),
    runChatCompletion: vi.fn(),
  }),
}));

vi.mock("../../context", () => ({
  useCopilotContext: () => ({
    availableAgents: [],
    coagentStates: {},
    coagentStatesRef: { current: {} },
    threadId: "test-thread",
    copilotApiConfig: { headers: {}, chatApiEndpoint: "test-endpoint" },
    showDevConsole: false,
  }),
  useCopilotMessagesContext: () => ({ messages: [] }),
}));

vi.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({ setBannerError: vi.fn() }),
}));

vi.mock("../../components/error-boundary/error-utils", () => ({
  useAsyncCallback: (fn: any) => fn,
}));

describe("useCoAgent returned agent methods", () => {
  beforeEach(() => {
    agent = new RecordingAgent({ agentId: "test-agent" });
    core = new CopilotKitCore({});
  });

  it("runs the agent when start is called detached from the result", async () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { start } = result.current;

    await act(async () => {
      await start();
    });

    expect(agent.inputs).toHaveLength(1);
  });

  it("runs the agent when run is called detached from the result", async () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { run } = result.current;

    await act(async () => {
      await run();
    });

    expect(agent.inputs).toHaveLength(1);
  });

  it("runs the agent when start is called as a method of the result", async () => {
    // Called this way, `this` is the result object, not the agent, so the
    // bare prototype method failed here too.
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));

    await act(async () => {
      await result.current.start();
    });

    expect(agent.inputs).toHaveLength(1);
  });

  it("sends the configured properties, frontend tools and context with the run", async () => {
    core.addTool({
      name: "greet",
      description: "Greets the user",
      handler: async () => "hi",
    });
    core.addContext({ description: "The user's plan", value: "pro" });

    const { result } = renderHook(() =>
      useCoAgent({
        name: "test-agent",
        config: { configurable: { model: "gpt-4o" } },
      }),
    );

    await act(async () => {
      await result.current.run({ forwardedProps: { source: "test" } });
    });

    const [input] = agent.inputs;
    expect(input.tools.map((tool) => tool.name)).toContain("greet");
    expect(input.context).toContainEqual({
      description: "The user's plan",
      value: "pro",
    });
    expect(input.forwardedProps).toMatchObject({
      configurable: { model: "gpt-4o" },
      source: "test",
    });
  });

  it("executes a frontend tool call the agent makes", async () => {
    const handler = vi.fn(async (_args: { name: string }) => "done");
    core.addTool({
      name: "greet",
      description: "Greets the user",
      handler,
      followUp: false,
    });
    agent.toolCall = { name: "greet", args: '{"name":"Ada"}' };

    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));

    await act(async () => {
      await result.current.run();
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ name: "Ada" });
  });

  it("forwards runId and returns the run's result", async () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.run({ runId: "run-42" });
    });

    expect(agent.inputs[0].runId).toBe("run-42");
    expect(returned).toEqual(expect.objectContaining({ newMessages: [] }));
  });

  it("keeps start, run and stop stable when the agent state changes", () => {
    const { result, rerender } = renderHook(() =>
      useCoAgent({ name: "test-agent" }),
    );
    const first = result.current;

    act(() => {
      agent.setState({ count: 1 });
    });
    rerender();

    // The result object is rebuilt, so the memo did recompute ...
    expect(result.current).not.toBe(first);
    // ... but the methods are the same functions, as the bare prototype
    // methods were before they were wrapped.
    expect(result.current.start).toBe(first.start);
    expect(result.current.run).toBe(first.run);
    expect(result.current.stop).toBe(first.stop);
  });

  it("stops through the core when stop is called detached from the result", () => {
    // The core's stopAgent also cancels in-flight tool handlers and the
    // follow-up run, which a bare agent.abortRun() does not.
    const stopAgent = vi.spyOn(core, "stopAgent");
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { stop } = result.current;

    act(() => {
      stop();
    });

    expect(stopAgent).toHaveBeenCalledWith({ agent });
    expect(agent.aborts).toBe(1);
  });
});
