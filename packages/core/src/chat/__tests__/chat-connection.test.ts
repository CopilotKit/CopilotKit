import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AbstractAgent,
  AGUIConnectNotImplementedError,
  EventType,
  HttpAgent,
} from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EMPTY, Subject } from "rxjs";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../../core/core";
import type { CopilotKitCoreSubscriber } from "../../core/core";
import {
  ɵChatConnection,
  ɵFreshThreadId,
  ɵimplementsConnect,
  ɵsubscribeToAgentErrors,
} from "../chat-connection";
import { CursorAgent, deferred, flush } from "./session-test-agent";

/** A core whose `connectAgent` the test settles by hand, with a way to emit errors. */
function createFakeCore() {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const connects: Array<{
    threadId: string | undefined;
    settle: ReturnType<typeof deferred<void>>;
  }> = [];
  const copilotkit = new CopilotKitCore({});
  const core = {
    stopAgent: vi.fn(),
    subscribe: (subscriber: CopilotKitCoreSubscriber) => {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    connectAgent: vi.fn(async ({ agent }: { agent: AbstractAgent }) => {
      const settle = deferred<void>();
      connects.push({ threadId: agent.threadId, settle });
      await settle.promise;
      return { result: undefined, newMessages: [] };
    }),
  };
  const emitError = (
    code: CopilotKitCoreErrorCode,
    context: Record<string, string>,
  ) => {
    for (const subscriber of subscribers) {
      void subscriber.onError?.({
        copilotkit,
        error: new Error(code),
        code,
        context,
      });
    }
  };
  return { core, connects, emitError };
}

/** A {@link CursorAgent} that implements connect, so the chat connects it. */
class ConnectableAgent extends CursorAgent {
  protected override connect() {
    return EMPTY;
  }
}

/** Runs the "after paint" callbacks at once, so tests need no animation frame. */
const immediately = (callback: () => void) => callback();

/** An agent without `connect`, like a plain `HttpAgent`, whose runs the test drives by hand. */
class RunDrivenAgent extends AbstractAgent {
  output = new Subject<BaseEvent>();
  readonly inputs: RunAgentInput[] = [];

  constructor() {
    super({ agentId: "chat" });
  }

  run(input: RunAgentInput) {
    this.output = new Subject<BaseEvent>();
    this.inputs.push(input);
    return this.output;
  }

  finish() {
    const input = this.inputs.at(-1)!;
    this.output.next({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    });
    this.output.next({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    });
    this.output.complete();
  }
}

/** A {@link RunDrivenAgent} whose connect stream the test drives too. */
class StreamingAgent extends RunDrivenAgent {
  readonly connection = new Subject<BaseEvent>();

  protected override connect() {
    return this.connection;
  }
}

class ConnectedHttpAgent extends HttpAgent {
  readonly connection = new Subject<BaseEvent>();
  /** The stream of the last run, which never reaches the network. */
  output = new Subject<BaseEvent>();

  constructor() {
    super({ agentId: "chat", url: "/agent" });
  }

  protected override connect() {
    return this.connection;
  }

  override run() {
    this.output = new Subject<BaseEvent>();
    return this.output;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ɵChatConnection.open", () => {
  it("does not connect an agent that does not implement connect", () => {
    const { core } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });

    connection.open({
      agent: new CursorAgent(),
      threadId: "t1",
      explicit: true,
    });

    expect(core.connectAgent).not.toHaveBeenCalled();
    expect(connection.isConnecting({ threadId: "t1", explicit: true })).toBe(
      false,
    );
  });

  it("pins the thread and does not connect a thread no caller picked", () => {
    const { core } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const agent = new ConnectableAgent();

    connection.open({ agent, threadId: "fresh", explicit: false });

    expect(agent.threadId).toBe("fresh");
    expect(core.connectAgent).not.toHaveBeenCalled();
    expect(
      connection.isConnecting({ threadId: "fresh", explicit: false }),
    ).toBe(false);
  });

  it("shows an explicit thread as connecting until its connect settles", async () => {
    const { core, connects } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const listener = vi.fn();
    connection.subscribe(listener);

    connection.open({
      agent: new ConnectableAgent(),
      threadId: "t1",
      explicit: true,
    });
    await vi.waitFor(() => expect(connects).toHaveLength(1));
    expect(connection.isConnecting({ threadId: "t1", explicit: true })).toBe(
      true,
    );

    connects[0]!.settle.resolve();
    await vi.waitFor(() =>
      expect(connection.getSnapshot().connectedThreadId).toBe("t1"),
    );
    expect(connection.isConnecting({ threadId: "t1", explicit: true })).toBe(
      false,
    );
    expect(connection.isConnecting({ threadId: "t2", explicit: true })).toBe(
      true,
    );
    expect(listener).toHaveBeenCalledOnce();
  });

  it("waits for the previous thread's teardown before connecting", async () => {
    const { core, connects } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const agent = new ConnectableAgent();
    const gate = deferred();
    agent.holdDetach(gate.promise);
    connection.open({ agent, threadId: "old", explicit: false }).release();

    // A fresh thread queues a detach; the explicit thread waits for it.
    connection.open({ agent, threadId: "fresh", explicit: false }).release();
    connection.open({ agent, threadId: "picked", explicit: true });
    await flush();
    expect(connects).toHaveLength(0);

    gate.resolve();
    await vi.waitFor(() => expect(connects).toHaveLength(1));
    expect(connects[0]!.threadId).toBe("picked");
  });

  it("never connects a thread released before its teardown finished", async () => {
    const { core } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const agent = new ConnectableAgent();

    connection.open({ agent, threadId: "t1", explicit: true }).release();
    await flush();

    expect(core.connectAgent).not.toHaveBeenCalled();
  });

  it("does not mark a thread connected when it was released while loading", async () => {
    const { core, connects } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const onSettled = vi.fn();

    const handle = connection.open(
      { agent: new ConnectableAgent(), threadId: "t1", explicit: true },
      { onSettled },
    );
    await vi.waitFor(() => expect(connects).toHaveLength(1));
    handle.release();
    connects[0]!.settle.resolve();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledWith(false));

    expect(connection.getSnapshot().connectedThreadId).toBeNull();
  });

  it("calls the start and settle hooks around the connect", async () => {
    const { core, connects } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const onStart = vi.fn();
    const onSettled = vi.fn();

    connection.open(
      { agent: new ConnectableAgent(), threadId: "t1", explicit: true },
      { onStart, onSettled },
    );
    expect(onStart).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(connects).toHaveLength(1));
    expect(onSettled).not.toHaveBeenCalled();
    connects[0]!.settle.resolve();

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledWith(true));
  });
});

describe("ɵChatConnection connect failures", () => {
  it("logs a failed connect and makes a waiting send fail", async () => {
    const { core } = createFakeCore();
    const error = new Error("down");
    core.connectAgent.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const connection = new ɵChatConnection({ core, afterPaint: immediately });

    const { selection } = connection.open({
      agent: new ConnectableAgent(),
      threadId: "t1",
      explicit: true,
    });

    expect(await connection.threads.waitForConnection(selection)).toBe(
      "failed",
    );
    expect(log).toHaveBeenCalledWith("CopilotChat: connection failed", error);
    expect(connection.getSnapshot().connectedThreadId).toBe("t1");
  });

  it("treats an agent that does not implement connect as connected", async () => {
    const { core } = createFakeCore();
    core.connectAgent.mockRejectedValueOnce(
      new AGUIConnectNotImplementedError(),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const onInspectorOverrideFailed = vi.fn();
    const connection = new ɵChatConnection({
      core,
      afterPaint: immediately,
      onInspectorOverrideFailed,
    });

    const { selection } = connection.open({
      agent: new ConnectableAgent(),
      threadId: "t1",
      explicit: true,
      inspectorRequestId: "inspect-1",
    });

    expect(await connection.threads.waitForConnection(selection)).toBe("ready");
    expect(log).not.toHaveBeenCalled();
    expect(onInspectorOverrideFailed).not.toHaveBeenCalled();
  });

  it("ends an Inspector override when its connect throws", async () => {
    const { core } = createFakeCore();
    core.connectAgent.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onInspectorOverrideFailed = vi.fn();
    const connection = new ɵChatConnection({
      core,
      afterPaint: immediately,
      onInspectorOverrideFailed,
    });

    connection.open({
      agent: new ConnectableAgent({ agentId: "chat" }),
      threadId: "inspected",
      explicit: true,
      inspectorRequestId: "inspect-1",
    });

    await vi.waitFor(() =>
      expect(onInspectorOverrideFailed).toHaveBeenCalledWith("inspect-1"),
    );
  });

  it("ends an Inspector override when core reports its thread failed", async () => {
    const { core, connects, emitError } = createFakeCore();
    const onInspectorOverrideFailed = vi.fn();
    const connection = new ɵChatConnection({
      core,
      afterPaint: immediately,
      onInspectorOverrideFailed,
    });

    const handle = connection.open({
      agent: new ConnectableAgent({ agentId: "chat" }),
      threadId: "inspected",
      explicit: true,
      inspectorRequestId: "inspect-1",
    });
    await vi.waitFor(() => expect(connects).toHaveLength(1));
    emitError(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED, {
      agentId: "other",
      threadId: "inspected",
    });
    emitError(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED, {
      agentId: "chat",
      threadId: "another",
    });
    expect(onInspectorOverrideFailed).not.toHaveBeenCalled();

    emitError(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED, {
      agentId: "chat",
      threadId: "inspected",
    });
    expect(onInspectorOverrideFailed).toHaveBeenCalledWith("inspect-1");

    handle.release();
    onInspectorOverrideFailed.mockClear();
    emitError(CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED, {
      agentId: "chat",
      threadId: "inspected",
    });
    expect(onInspectorOverrideFailed).not.toHaveBeenCalled();
  });
});

describe("ɵChatConnection release", () => {
  function createRealConnection() {
    const core = new CopilotKitCore({});
    return {
      core,
      connection: new ɵChatConnection({ core, afterPaint: immediately }),
    };
  }

  it("detaches the connect's own run when the chat leaves while it loads", async () => {
    const { connection } = createRealConnection();
    const agent = new StreamingAgent();
    const handle = connection.open({ agent, threadId: "t1", explicit: true });
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    const detach = vi.spyOn(agent, "detachActiveRun");

    handle.release();
    handle.release();

    await vi.waitFor(() => expect(agent.isRunning).toBe(false));
    expect(detach).toHaveBeenCalledOnce();
  });

  it("empties an agent without connect and stops its run when the chat moves to another thread", async () => {
    const { core, connection } = createRealConnection();
    const agent = new RunDrivenAgent();
    connection.open({ agent, threadId: "a", explicit: true });
    // The first thread keeps what the chat holds, such as a message sent
    // right after mount.
    agent.addMessage({ id: "m1", role: "user", content: "hi" });
    await flush();
    expect(agent.messages.map((message) => message.id)).toEqual(["m1"]);
    const run = core.runAgent({ agent });
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    const streaming = agent.output;

    const { selection } = connection.open({
      agent,
      threadId: "b",
      explicit: true,
    });

    expect(agent.messages).toEqual([]);
    expect(await connection.threads.waitForConnection(selection)).toBe("ready");
    expect(agent.isRunning).toBe(false);
    // The old thread's reply no longer reaches the agent.
    streaming.next({
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "late",
      role: "assistant",
      delta: "from a",
    });
    expect(agent.messages).toEqual([]);
    expect(connection.isConnecting({ threadId: "b", explicit: true })).toBe(
      false,
    );
    await run;
  });

  it("leaves a run the user started after the connect running", async () => {
    const { core, connection } = createRealConnection();
    const agent = new StreamingAgent();
    const handle = connection.open({ agent, threadId: "t1", explicit: true });
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    agent.connection.complete();
    await vi.waitFor(() =>
      expect(connection.getSnapshot().connectedThreadId).toBe("t1"),
    );
    const run = core.runAgent({ agent });
    await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
    const detach = vi.spyOn(agent, "detachActiveRun");

    handle.release();

    expect(detach).not.toHaveBeenCalled();
    agent.finish();
    await run;
  });

  it("leaves a run that took over the connect's pipeline running", async () => {
    const { connection } = createRealConnection();
    const agent = new StreamingAgent();
    const handle = connection.open({ agent, threadId: "t1", explicit: true });
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    // A run started on the agent directly, without core detaching the connect.
    const external = agent.runAgent();
    await vi.waitFor(() => expect(agent.inputs).toHaveLength(1));
    const detach = vi.spyOn(agent, "detachActiveRun");

    handle.release();

    expect(detach).not.toHaveBeenCalled();
    agent.finish();
    await external;
  });

  it("aborts an HttpAgent connect that is still loading", async () => {
    const { connection } = createRealConnection();
    const agent = new ConnectedHttpAgent();
    const handle = connection.open({ agent, threadId: "t1", explicit: true });
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    const controller = agent.abortController;

    handle.release();

    expect(controller.signal.aborted).toBe(true);
  });

  it("does not take a run that started before the connect for the connect's own", async () => {
    const { connection } = createRealConnection();
    const agent = new ConnectedHttpAgent();
    // The previous thread's teardown holds the connect back.
    const teardown = deferred();
    connection.threads.queueTeardown(teardown.promise);
    const handle = connection.open({ agent, threadId: "t1", explicit: true });
    // A run that starts meanwhile, such as a tool follow-up.
    const earlier = agent.runAgent();
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    const connectAgent = vi.spyOn(agent, "connectAgent");
    teardown.resolve();
    await vi.waitFor(() => expect(connectAgent).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    const controller = agent.abortController;
    const detach = vi.spyOn(agent, "detachActiveRun");

    handle.release();

    expect(controller.signal.aborted).toBe(true);
    expect(detach).toHaveBeenCalledOnce();
    await earlier.catch(() => {});
  });

  it("does not abort a successor connect that reuses the controller", async () => {
    const { core, connection } = createRealConnection();
    const agent = new ConnectedHttpAgent();
    const handle = connection.open({ agent, threadId: "t1", explicit: true });
    await vi.waitFor(() => expect(agent.isRunning).toBe(true));
    const controller = agent.abortController;
    // A second connect on the same agent reuses its controller.
    const successor = core.connectAgent({ agent });
    await flush();
    const detach = vi.spyOn(agent, "detachActiveRun");

    handle.release();

    expect(detach).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    await agent.detachActiveRun();
    await successor;
  });
});

describe("ɵChatConnection.track", () => {
  it("makes a send wait for a reconnect of the current thread", async () => {
    const { core, connects } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const { selection } = connection.open({
      agent: new ConnectableAgent(),
      threadId: "fresh",
      explicit: false,
    });
    const reconnect = deferred();
    void connection.track(() => reconnect.promise);

    let result: string | undefined;
    void connection.threads.waitForConnection(selection).then((value) => {
      result = value;
    });
    await flush();
    expect(result).toBeUndefined();

    reconnect.resolve();
    await vi.waitFor(() => expect(result).toBe("ready"));
    expect(connects).toHaveLength(0);
  });

  it("logs a failure when no thread is shown", async () => {
    const { core } = createFakeCore();
    const connection = new ɵChatConnection({ core, afterPaint: immediately });
    const error = new Error("down");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await connection.track(() => Promise.reject(error));

    expect(log).toHaveBeenCalledWith("CopilotChat: connection failed", error);
  });
});

describe("ɵimplementsConnect", () => {
  it("tells an agent with its own connect from one with AG-UI's base", () => {
    expect(ɵimplementsConnect(new CursorAgent())).toBe(false);
    expect(ɵimplementsConnect(new ConnectableAgent())).toBe(true);
    expect(ɵimplementsConnect(new StreamingAgent())).toBe(true);
  });
});

describe("ɵFreshThreadId", () => {
  it("keeps one id while no thread is provided", () => {
    const fresh = new ɵFreshThreadId();
    const first = fresh.resolve(undefined);

    expect(fresh.resolve(undefined)).toBe(first);
  });

  it("returns a provided thread, and a new fresh id once it goes away", () => {
    const fresh = new ɵFreshThreadId();
    const initial = fresh.resolve(undefined);

    expect(fresh.resolve("saved")).toBe("saved");
    const next = fresh.resolve(undefined);

    expect(next).not.toBe(initial);
    expect(next).not.toBe("saved");
    expect(fresh.resolve(undefined)).toBe(next);
  });
});

describe("ɵsubscribeToAgentErrors", () => {
  it("forwards errors for the agent and errors that name no agent", () => {
    const { core, emitError } = createFakeCore();
    const handler = vi.fn();
    const unsubscribe = ɵsubscribeToAgentErrors(core, "chat", handler);

    emitError(CopilotKitCoreErrorCode.AGENT_RUN_FAILED, { agentId: "chat" });
    emitError(CopilotKitCoreErrorCode.AGENT_RUN_FAILED, { agentId: "other" });
    emitError(CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED, {});

    expect(handler.mock.calls.map(([event]) => event.code)).toEqual([
      CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
      CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    ]);

    unsubscribe();
    emitError(CopilotKitCoreErrorCode.AGENT_RUN_FAILED, { agentId: "chat" });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
