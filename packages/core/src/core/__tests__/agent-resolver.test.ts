import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../../agent";
import { CopilotKitCore } from "../core";
import {
  ɵAgentResolver,
  ɵagentUpdateHandlers,
  ɵgetAgentResolver,
  ɵresolveAgentId,
  ɵresolveAgentThreadId,
  ɵsnapshotAgentState,
  ɵsubscribeToAgentUpdates,
  ɵvalidateAgentBinding,
} from "../agent-resolver";

class TestAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>();
  }
}

function userMessage(id: string, content: string): Message {
  return { id, role: "user", content };
}

/** A core with a runtime URL whose `/info` sync has not started. */
function createWaitingCore() {
  return new CopilotKitCore({
    runtimeUrl: "https://runtime.local/api",
    deferInitialConnection: true,
    credentials: "include",
  });
}

function createLocalCore(agents: Record<string, AbstractAgent> = {}) {
  return new CopilotKitCore({ agents__unsafe_dev_only: agents });
}

function registerAgent(core: CopilotKitCore, id: string) {
  const agent = new TestAgent();
  core.addAgent__unsafe_dev_only({ id, agent });
  return agent;
}

describe("ɵvalidateAgentBinding", () => {
  it("accepts the unscoped and the fully thread-scoped shapes", () => {
    expect(() => ɵvalidateAgentBinding({})).not.toThrow();
    expect(() => ɵvalidateAgentBinding({ agentId: "a" })).not.toThrow();
    expect(() =>
      ɵvalidateAgentBinding({
        agentId: "chat-1",
        runtimeAgentId: "default",
        threadId: "t-1",
      }),
    ).not.toThrow();
  });

  it("rejects a threadId without runtimeAgentId", () => {
    expect(() =>
      ɵvalidateAgentBinding({ agentId: "a", threadId: "t-1" }),
    ).toThrow(/`threadId` requires `runtimeAgentId`/);
  });

  it("rejects a runtimeAgentId without threadId", () => {
    expect(() =>
      ɵvalidateAgentBinding({ agentId: "a", runtimeAgentId: "default" }),
    ).toThrow(/`runtimeAgentId` requires `threadId`/);
  });

  it("rejects a runtimeAgentId without an explicit agentId", () => {
    expect(() =>
      ɵvalidateAgentBinding({ runtimeAgentId: "default", threadId: "t-1" }),
    ).toThrow(/requires an explicit `agentId`/);
  });
});

describe("ɵresolveAgentId", () => {
  it("prefers the explicit id, then chat, then provider, then default", () => {
    expect(
      ɵresolveAgentId({
        agentId: "explicit",
        chatAgentId: "chat",
        providerAgentId: "provider",
      }),
    ).toBe("explicit");
    expect(
      ɵresolveAgentId({ chatAgentId: "chat", providerAgentId: "provider" }),
    ).toBe("chat");
    expect(ɵresolveAgentId({ providerAgentId: "provider" })).toBe("provider");
    expect(ɵresolveAgentId({})).toBe("default");
  });
});

describe("ɵresolveAgentThreadId", () => {
  it("uses an explicit thread, else only an explicit chat thread", () => {
    expect(
      ɵresolveAgentThreadId({
        threadId: "own",
        chatThreadId: "chat",
        chatHasExplicitThreadId: true,
      }),
    ).toBe("own");
    expect(
      ɵresolveAgentThreadId({
        chatThreadId: "chat",
        chatHasExplicitThreadId: true,
      }),
    ).toBe("chat");
    expect(
      ɵresolveAgentThreadId({
        chatThreadId: "placeholder",
        chatHasExplicitThreadId: false,
      }),
    ).toBeUndefined();
  });
});

describe("ɵsnapshotAgentState", () => {
  it("copies objects and arrays and passes primitives through", () => {
    const state = { a: 1 };
    const list = [1, 2];
    expect(ɵsnapshotAgentState(state)).toEqual({ a: 1 });
    expect(ɵsnapshotAgentState(state)).not.toBe(state);
    expect(ɵsnapshotAgentState(list)).toEqual([1, 2]);
    expect(ɵsnapshotAgentState(list)).not.toBe(list);
    expect(ɵsnapshotAgentState(null)).toBeNull();
    expect(ɵsnapshotAgentState("x")).toBe("x");
  });
});

describe("ɵAgentResolver.resolve", () => {
  it("returns a registered agent as ready", () => {
    const agent = new TestAgent();
    const core = createLocalCore({ support: agent });
    const resolver = new ɵAgentResolver(core);

    expect(
      resolver.resolve({ agentId: "support", caller: "useAgent" }),
    ).toEqual({ agent, isReady: true });
  });

  it("returns one shared provisional agent while the runtime has not synced", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);

    const first = resolver.resolve({ agentId: "support", caller: "useAgent" });
    const second = resolver.resolve({ agentId: "support", caller: "useAgent" });

    expect(first.isReady).toBe(false);
    expect(second.agent).toBe(first.agent);
    expect(first.agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect(first.agent.agentId).toBe("support");
  });

  it("gives the provisional agent the core's request settings", () => {
    const messageFilter = (messages: Message[]) => messages;
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.local/api",
      deferInitialConnection: true,
      credentials: "include",
      messageFilter,
    });
    const { agent } = new ɵAgentResolver(core).resolve({
      agentId: "support",
      caller: "useAgent",
    });

    expect(agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    if (!(agent instanceof ProxiedCopilotRuntimeAgent)) return;
    expect(agent.credentials).toBe("include");
    expect(agent.runtimeUrl).toBe("https://runtime.local/api");
    expect(agent.messageFilter).toBe(messageFilter);
  });

  it("refreshes credentials on a cached provisional agent", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);
    const first = resolver.resolve({ agentId: "support", caller: "useAgent" });

    core.setCredentials("omit");
    const second = resolver.resolve({ agentId: "support", caller: "useAgent" });

    expect(second.agent).toBe(first.agent);
    expect(second.agent).toHaveProperty("credentials", "omit");
  });

  it("throws a not-found error that names the caller and known agents", () => {
    const core = createLocalCore({ other: new TestAgent() });
    const resolver = new ɵAgentResolver(core);

    expect(() =>
      resolver.resolve({ agentId: "missing", caller: "injectAgentStore" }),
    ).toThrow(
      "injectAgentStore: Agent 'missing' not found after runtime sync (no runtimeUrl). " +
        "Known agents: [other] Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
  });

  it("copies data written to the provisional agent onto the registered one", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);
    const provisional = resolver.resolve({
      agentId: "support",
      caller: "useAgent",
    }).agent;
    provisional.setMessages([userMessage("m1", "Hello")]);
    provisional.setState({ draft: "x" });

    const registered = registerAgent(core, "support");
    const resolved = resolver.resolve({
      agentId: "support",
      caller: "useAgent",
    });

    expect(resolved).toEqual({ agent: registered, isReady: true });
    expect(registered.messages).toEqual([userMessage("m1", "Hello")]);
    expect(registered.state).toEqual({ draft: "x" });
  });

  it("mirrors later provisional updates to the registered agent", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);
    const provisional = resolver.resolve({
      agentId: "support",
      caller: "useAgent",
    }).agent;
    provisional.setMessages([userMessage("m1", "Hello")]);
    const registered = registerAgent(core, "support");
    resolver.resolve({ agentId: "support", caller: "useAgent" });

    provisional.setState({ step: "done" });

    expect(registered.state).toEqual({ step: "done" });
  });

  it("copies restored registered data back to an empty provisional agent", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);
    const provisional = resolver.resolve({
      agentId: "support",
      caller: "useAgent",
    }).agent;
    const registered = new TestAgent({
      initialMessages: [userMessage("r1", "Welcome back")],
      initialState: { document: "Restored" },
    });
    core.addAgent__unsafe_dev_only({ id: "support", agent: registered });

    resolver.resolve({ agentId: "support", caller: "useAgent" });

    expect(provisional.messages).toEqual([userMessage("r1", "Welcome back")]);
    expect(provisional.state).toEqual({ document: "Restored" });
  });
});

describe("ɵAgentResolver.bindProxy", () => {
  it("hands out a routed provisional until the proxy is registered", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);
    const input = {
      agentId: "chat-1",
      runtimeAgentId: "default",
      caller: "useAgent",
    };

    const before = resolver.resolve(input);
    expect(before.isReady).toBe(false);
    expect(before.agent).toHaveProperty("runtimeAgentId", "default");

    const listener = vi.fn();
    resolver.subscribe(listener);
    const unbind = resolver.bindProxy({
      agentId: "chat-1",
      runtimeAgentId: "default",
    });
    const after = resolver.resolve(input);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(after.isReady).toBe(true);
    expect(after.agent).toBe(core.getAgent("chat-1"));
    expect(after.agent).not.toBe(before.agent);

    unbind();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(core.getAgent("chat-1")).toBeUndefined();
    expect(resolver.resolve(input).isReady).toBe(false);
  });
});

describe("ɵAgentResolver.refreshRequestSettings", () => {
  it("writes the current credentials onto a runtime agent", () => {
    const core = createWaitingCore();
    const resolver = new ɵAgentResolver(core);
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.local/api",
      agentId: "x",
    });

    resolver.refreshRequestSettings(agent);

    expect(agent.credentials).toBe("include");
  });
});

describe("ɵgetAgentResolver", () => {
  it("returns one resolver per core", () => {
    const core = createLocalCore();
    expect(ɵgetAgentResolver(core)).toBe(ɵgetAgentResolver(core));
    expect(ɵgetAgentResolver(core)).not.toBe(
      ɵgetAgentResolver(createLocalCore()),
    );
  });
});

describe("ɵagentUpdateHandlers", () => {
  it("maps run status to every run lifecycle callback, including run start", () => {
    const notify = () => {};
    const handlers = ɵagentUpdateHandlers(["OnRunStatusChanged"], notify);

    expect(Object.keys(handlers).sort()).toEqual([
      "onRunErrorEvent",
      "onRunFailed",
      "onRunFinalized",
      "onRunInitialized",
      "onRunStartedEvent",
    ]);
  });

  it("maps messages and state to their own callbacks", () => {
    const notify = () => {};

    expect(
      Object.keys(
        ɵagentUpdateHandlers(["OnMessagesChanged", "OnStateChanged"], notify),
      ).sort(),
    ).toEqual(["onMessagesChanged", "onStateChanged"]);
  });
});

describe("ɵsubscribeToAgentUpdates", () => {
  it("coalesces notifications from one tick into one update", async () => {
    const core = createLocalCore();
    const agent = new TestAgent();
    const onUpdate = vi.fn();
    ɵsubscribeToAgentUpdates(core, agent, {
      updates: ["OnMessagesChanged", "OnStateChanged"],
      onUpdate,
    });

    agent.setMessages([userMessage("m1", "Hi")]);
    agent.setState({ a: 1 });
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores notifications for flags that were not selected", async () => {
    const core = createLocalCore();
    const agent = new TestAgent();
    const onUpdate = vi.fn();
    ɵsubscribeToAgentUpdates(core, agent, {
      updates: ["OnStateChanged"],
      onUpdate,
    });

    agent.setMessages([userMessage("m1", "Hi")]);
    await Promise.resolve();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("drops a scheduled update after unsubscribe", async () => {
    const core = createLocalCore();
    const agent = new TestAgent();
    const onUpdate = vi.fn();
    const unsubscribe = ɵsubscribeToAgentUpdates(core, agent, {
      updates: ["OnMessagesChanged"],
      onUpdate,
    });

    agent.setMessages([userMessage("m1", "Hi")]);
    unsubscribe();
    await Promise.resolve();

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
