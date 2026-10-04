import { vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import { Observable } from "rxjs";
import { useCoAgent } from "../use-coagent";

// A real agent, not a mock: the bug is that `start`, `run` and `stop` were
// returned as unbound prototype methods, which only shows up when the methods
// actually read `this`. vi.fn() mocks do not, so they cannot catch it (#3132).
class RecordingAgent extends AbstractAgent {
  runs = 0;
  aborts = 0;

  run(): Observable<BaseEvent> {
    this.runs += 1;
    return new Observable<BaseEvent>((subscriber) => subscriber.complete());
  }

  abortRun(): void {
    // `this` is undefined when the method is called unbound.
    this.aborts += 1;
  }
}

const agent = new RecordingAgent({ agentId: "test-agent" });

vi.mock("../../../v2", () => ({
  useAgent: vi.fn(() => ({ agent })),
  useCopilotKit: vi.fn(() => ({
    copilotkit: { setProperties: vi.fn() },
  })),
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
    agent.runs = 0;
    agent.aborts = 0;
  });

  it("runs the agent when start is called detached from the result", async () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { start } = result.current;

    await act(async () => {
      await start();
    });

    expect(agent.runs).toBe(1);
  });

  it("runs the agent when run is called detached from the result", async () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { run } = result.current;

    await act(async () => {
      await run();
    });

    expect(agent.runs).toBe(1);
  });

  it("forwards run's arguments to runAgent and returns its result", async () => {
    const runAgent = vi.spyOn(agent, "runAgent");
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const parameters = { forwardedProps: { source: "test" } };

    let returned: unknown;
    await act(async () => {
      returned = await result.current.run(parameters);
    });

    expect(runAgent).toHaveBeenCalledWith(parameters);
    expect(returned).toBe(await runAgent.mock.results[0].value);
    runAgent.mockRestore();
  });

  it("runs the agent when start is called as a method of the result", async () => {
    // Called this way, `this` is the result object, not the agent, so the
    // bare prototype method failed here too.
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));

    await act(async () => {
      await result.current.start();
    });

    expect(agent.runs).toBe(1);
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

  it("aborts the agent when stop is called detached from the result", () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { stop } = result.current;

    act(() => {
      stop();
    });

    expect(agent.aborts).toBe(1);
  });
});
