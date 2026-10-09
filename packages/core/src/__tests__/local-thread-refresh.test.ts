import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitCore } from "../core/core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { ɵcreateThreadStore } from "../threads";

const stores: ReturnType<typeof ɵcreateThreadStore>[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.stop());
  vi.restoreAllMocks();
});

function setup(agentId = "default") {
  const core = new CopilotKitCore({});
  const agent = new HttpAgent({ agentId, url: "http://localhost:4000/agent" });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ threads: [] })));
  const store = ɵcreateThreadStore({ fetch });
  stores.push(store);
  store.start();
  store.setContext({
    runtimeUrl: "http://localhost:4000",
    agentId,
    headers: {},
  });
  core.registerThreadStore(agentId, store);
  const refresh = vi.spyOn(store, "refetchThreads");
  return { core, agent, store, fetch, refresh };
}

describe("local thread refresh after agent runs", () => {
  it.each([false, true])(
    "discovers the persisted thread after a run (failed=%s)",
    async (failed) => {
      const { core, agent, store, fetch, refresh } = setup();
      await vi.waitFor(() => expect(store.getState().isLoading).toBe(false));
      const thread = {
        id: "new-thread",
        agentId: "default",
        name: "New conversation",
        archived: false,
        createdAt: "2026-09-09T00:00:00Z",
        updatedAt: "2026-09-09T00:00:00Z",
      };
      vi.spyOn(agent, "runAgent").mockImplementation(async () => {
        expect(refresh).not.toHaveBeenCalled();
        fetch.mockResolvedValue(
          new Response(JSON.stringify({ threads: [thread] })),
        );
        if (failed) throw new Error("Agent failed after persisting its thread");
        return { result: undefined, newMessages: [] };
      });

      await core.runAgent({ agent });

      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(store.selectors.threads(store.getState())).toEqual([thread]);
      });
      expect(core.getThreadStore("default")).toBe(store);
    },
  );

  it("does not refresh a store with a realtime feed", async () => {
    const { core, agent, store, refresh } = setup();
    // Set the context without starting a websocket connection in this test.
    vi.spyOn(store, "getState").mockReturnValue({
      ...store.getState(),
      context: {
        runtimeUrl: "http://localhost:4000",
        agentId: "default",
        headers: {},
        wsUrl: "ws://localhost:4000",
      },
    });
    vi.spyOn(agent, "runAgent").mockResolvedValue({
      result: undefined,
      newMessages: [],
    });
    await core.runAgent({ agent });
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["disabled", "unregistered", "other-agent"])(
    "does not refresh a %s store",
    async (condition) => {
      const { core, agent, store, refresh } = setup();
      if (condition === "disabled") store.setContext(null);
      if (condition === "unregistered") core.unregisterThreadStore("default");
      if (condition === "other-agent") agent.agentId = "other";
      vi.spyOn(agent, "runAgent").mockResolvedValue({
        result: undefined,
        newMessages: [],
      });
      await core.runAgent({ agent });
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it("refreshes the runtime agent's store for a thread-scoped proxy", async () => {
    const { core, refresh } = setup();
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:4000",
      agentId: "private-thread-agent",
      runtimeAgentId: "default",
    });
    vi.spyOn(agent, "runAgent").mockResolvedValue({
      result: undefined,
      newMessages: [],
    });
    await core.runAgent({ agent });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes before waiting for a human-in-the-loop tool", async () => {
    const { core, agent, refresh } = setup();
    let approve!: (value: string) => void;
    const decision = new Promise<string>((resolve) => {
      approve = resolve;
    });
    const handler = vi.fn(() => decision);
    core.addTool({ name: "approval", handler, followUp: false });
    const message = {
      id: "approval-message",
      role: "assistant" as const,
      toolCalls: [
        {
          id: "approval-call",
          type: "function" as const,
          function: { name: "approval", arguments: "{}" },
        },
      ],
    };
    agent.setMessages([message]);
    vi.spyOn(agent, "runAgent").mockResolvedValue({
      result: undefined,
      newMessages: [message],
    });
    const run = core.runAgent({ agent });
    try {
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      approve("approved");
      await run;
    }
  });
});
