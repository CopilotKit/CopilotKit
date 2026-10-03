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

  it("aborts the agent when stop is called detached from the result", () => {
    const { result } = renderHook(() => useCoAgent({ name: "test-agent" }));
    const { stop } = result.current;

    act(() => {
      stop();
    });

    expect(agent.aborts).toBe(1);
  });
});
