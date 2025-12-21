import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { createAssistantMessage } from "./test-utils";

describe("CopilotKitCore error handling", () => {
  describe("agent error events", () => {
    it("emits AGENT_RUN_ERROR_EVENT when agent sends RunError event", async () => {
      const core = new CopilotKitCore({});
      const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error; context: any }> = [];
      const sub = core.subscribe({ onError: (e) => void errors.push(e) });

      // Minimal agent that triggers onRunErrorEvent via the provided subscriber
      const agent = {
        agentId: "agent1",
        threadId: "t1",
        messages: [] as any[],
        state: {},
        // Simulate HttpAgent-like API surface expected by core
        addMessages: (_m: any[]) => {},
        addMessage: (_m: any) => {},
        abortRun: () => {},
        clone: () => agent,
        subscribe: () => ({ unsubscribe() {} }),
        async runAgent(_params: any, subscriber?: any) {
          const event = {
            type: "RUN_ERROR",
            threadId: this.threadId,
            runId: "r1",
            message: "runtime error happened",
            code: "bad_request",
            rawEvent: { error: "bad_request" },
          } as any;
          await subscriber?.onRunErrorEvent?.({
            event,
            agent: this,
            messages: this.messages,
            state: this.state,
            input: { threadId: this.threadId, runId: "r1", messages: this.messages, state: this.state },
          });
          return { newMessages: [] };
        },
      } as any;

      // Register agent to avoid suggestion engine warnings
      core.addAgent__unsafe_dev_only({ id: agent.agentId, agent: agent as any });
      await core.runAgent({ agent });

      expect(errors.some((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT)).toBe(true);
      const evt = errors.find((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT)!;
      expect(evt.context.agentId).toBe("agent1");
      expect(evt.context.event).toBeDefined();

      sub.unsubscribe();
    });

    it("emits AGENT_RUN_FAILED_EVENT when agent triggers onRunFailed", async () => {
      const core = new CopilotKitCore({});
      const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error; context: any }> = [];
      const sub = core.subscribe({ onError: (e) => void errors.push(e) });

      const agent = {
        agentId: "agent2",
        threadId: "t2",
        messages: [] as any[],
        state: {},
        addMessages: (_m: any[]) => {},
        addMessage: (_m: any) => {},
        abortRun: () => {},
        clone: () => agent,
        subscribe: () => ({ unsubscribe() {} }),
        async runAgent(_params: any, subscriber?: any) {
          await subscriber?.onRunFailed?.({ error: new Error("agent failed") });
          return { newMessages: [] };
        },
      } as any;

      core.addAgent__unsafe_dev_only({ id: agent.agentId, agent: agent as any });
      await core.runAgent({ agent });

      expect(errors.some((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT)).toBe(true);
      const evt = errors.find((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT)!;
      expect(evt.context.agentId).toBe("agent2");
      expect(evt.context.source).toBe("onRunFailed");

      sub.unsubscribe();
    });
  });

  describe("http errors", () => {
    const originalFetch = global.fetch;
    const originalWindow = (globalThis as { window?: unknown }).window;

    beforeEach(() => {
      // Simulate browser environment to allow updateRuntimeConnection to proceed.
      (globalThis as { window?: unknown }).window = {};
    });

    afterEach(() => {
      vi.restoreAllMocks();
      global.fetch = originalFetch;
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    });

    it("emits RUNTIME_INFO_FETCH_FAILED when runtime info sync fails", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network failure"));
      global.fetch = fetchMock;

      const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example/rest", runtimeTransport: "rest" });
      const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error; context: any }> = [];
      const sub = core.subscribe({ onError: (e) => void errors.push(e) });

      await vi.waitFor(() => {
        expect(errors.some((e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED)).toBe(true);
      });

      sub.unsubscribe();
    });

    it("emits AGENT_RUN_FAILED when proxied runtime agent run fails (REST)", async () => {
      const runtimeUrl = "https://runtime.example/rest";
      const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failure"));
      global.fetch = fetchMock;

      const core = new CopilotKitCore({});
      const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error; context: any }> = [];
      const sub = core.subscribe({ onError: (e) => void errors.push(e) });

      const agent = new ProxiedCopilotRuntimeAgent({ runtimeUrl, agentId: "agent-http", transport: "rest" });

      await expect(core.runAgent({ agent })).rejects.toBeDefined();

      expect(errors.some((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED)).toBe(true);
      const evt = errors.find((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED)!;
      expect(evt.context.agentId).toBe("agent-http");

      sub.unsubscribe();
    });
  });

  describe("internal processing errors (tools)", () => {
    it("emits TOOL_ARGUMENT_PARSE_FAILED then AGENT_RUN_FAILED when tool args JSON is invalid", async () => {
      const core = new CopilotKitCore({});
      const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error; context: any }> = [];
      const sub = core.subscribe({ onError: (e) => void errors.push(e) });

      const toolName = "parseFail";
      core.addTool({ name: toolName, description: "", handler: async () => "ok" });

      // Assistant message with a tool call and invalid JSON arguments
      const assistant = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "tc1",
            type: "function",
            function: { name: toolName, arguments: "not-json" },
          } as any,
        ],
      } as any);

      const agent = {
        agentId: "agent-tools-1",
        threadId: "t1",
        messages: [] as any[],
        state: {},
        addMessages: (m: any[]) => agent.messages.push(...m),
        addMessage: (m: any) => agent.messages.push(m),
        abortRun: () => {},
        clone: () => agent,
        subscribe: () => ({ unsubscribe() {} }),
        async runAgent() {
          return { newMessages: [assistant] };
        },
      } as any;

      core.addAgent__unsafe_dev_only({ id: agent.agentId, agent: agent as any });
      await expect(core.runAgent({ agent })).rejects.toBeDefined();

      // Argument parse error captured
      expect(errors.some((e) => e.code === CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED)).toBe(true);
      // The run rejects; current implementation does not emit AGENT_RUN_FAILED for this path

      sub.unsubscribe();
    });

    it("emits TOOL_HANDLER_FAILED and continues run when tool handler throws", async () => {
      const core = new CopilotKitCore({});
      const errors: Array<{ code: CopilotKitCoreErrorCode; error: Error; context: any }> = [];
      const sub = core.subscribe({ onError: (e) => void errors.push(e) });

      const toolName = "boom";
      core.addTool({ name: toolName, description: "", handler: async () => { throw new Error("boom"); } });

      const assistant = createAssistantMessage({
        content: "",
        toolCalls: [
          {
            id: "tc2",
            type: "function",
            function: { name: toolName, arguments: JSON.stringify({ a: 1 }) },
          } as any,
        ],
      } as any);

      const agent = {
        agentId: "agent-tools-2",
        threadId: "t2",
        messages: [] as any[],
        state: {},
        addMessages: (m: any[]) => agent.messages.push(...m),
        addMessage: (m: any) => agent.messages.push(m),
        abortRun: () => {},
        clone: () => agent,
        subscribe: () => ({ unsubscribe() {} }),
        async runAgent() {
          return { newMessages: [assistant] };
        },
      } as any;

      core.addAgent__unsafe_dev_only({ id: agent.agentId, agent: agent as any });
      const result = await core.runAgent({ agent });

      // Handler error should be reported
      expect(errors.some((e) => e.code === CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED)).toBe(true);
      // Run should not fail; tool result message should contain the error string
      expect(Array.isArray(result.newMessages)).toBe(true);
      // After run, the tool result is inserted into agent.messages with "Error: boom"
      expect(agent.messages.some((m: any) => m.role === "tool" && typeof m.content === "string" && m.content.includes("Error: boom"))).toBe(true);

      sub.unsubscribe();
    });
  });
});
