import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { HttpAgent } from "@ag-ui/client";
import { waitForCondition } from "./test-utils";

describe("CopilotKitCore headers", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as any).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock window to simulate browser environment
    (global as any).window = {};
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as { fetch?: typeof fetch }).fetch;
    }
    // Restore window
    if (originalWindow === undefined) {
      delete (global as any).window;
    } else {
      (global as any).window = originalWindow;
    }
  });

  it("includes provided headers when fetching runtime info", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const headers = {
      Authorization: "Bearer test-token",
      "X-Custom-Header": "custom-value",
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      headers,
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example/info",
      expect.objectContaining({
        headers: expect.objectContaining(headers),
      }),
    );
  });

  it("uses updated headers for subsequent runtime requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      headers: { Authorization: "Bearer initial" },
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    core.setHeaders({ Authorization: "Bearer updated", "X-Trace": "123" });
    core.setRuntimeUrl(undefined);
    core.setRuntimeUrl("https://runtime.example");

    await waitForCondition(() => fetchMock.mock.calls.length >= 2);

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall?.[1]?.headers).toMatchObject({
      Authorization: "Bearer updated",
      "X-Trace": "123",
    });
  });

  it("passes configured headers to HttpAgent runs", async () => {
    const recorded: Array<Record<string, string>> = [];

    class RecordingHttpAgent extends HttpAgent {
      constructor() {
        super({ url: "https://runtime.example" });
      }

      async connectAgent(...args: Parameters<HttpAgent["connectAgent"]>) {
        recorded.push({ ...this.headers });
        return Promise.resolve({
          result: undefined,
          newMessages: [],
        }) as ReturnType<HttpAgent["connectAgent"]>;
      }

      async runAgent(...args: Parameters<HttpAgent["runAgent"]>) {
        recorded.push({ ...this.headers });
        return Promise.resolve({
          result: undefined,
          newMessages: [],
        }) as ReturnType<HttpAgent["runAgent"]>;
      }
    }

    const agent = new RecordingHttpAgent();

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer cfg", "X-Team": "angular" },
      agents__unsafe_dev_only: { default: agent },
    });

    await agent.runAgent();
    await core.connectAgent({ agent });
    await core.runAgent({ agent });

    expect(recorded).toHaveLength(3);
    for (const headers of recorded) {
      expect(headers).toMatchObject({
        Authorization: "Bearer cfg",
        "X-Team": "angular",
      });
    }
  });

  it("preserves agent-level headers not overridden by core headers (#5635)", () => {
    const agent = new HttpAgent({
      url: "https://runtime.example",
      headers: { Authorization: "Bearer agent-token" },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      // No core-level headers configured at all.
      agents__unsafe_dev_only: { default: agent },
    });

    // The agent's own Authorization header must survive registration.
    expect(agent.headers).toMatchObject({
      Authorization: "Bearer agent-token",
    });
  });

  it("merges core headers over agent-level headers (#5635)", () => {
    const agent = new HttpAgent({
      url: "https://runtime.example",
      headers: {
        "X-Agent": "agent-value",
        Authorization: "Bearer agent-token",
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer core-token", "X-Core": "core-value" },
      agents__unsafe_dev_only: { default: agent },
    });

    // Agent-only header survives, core-only header is added, and the conflicting
    // Authorization is won by the core (provider-level) value.
    expect(agent.headers).toEqual({
      "X-Agent": "agent-value",
      Authorization: "Bearer core-token",
      "X-Core": "core-value",
    });
  });

  it("retains agent-level headers across setHeaders updates (#5635)", () => {
    const agent = new HttpAgent({
      url: "https://runtime.example",
      headers: { "X-Agent": "agent-value" },
    });

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer initial" },
      agents__unsafe_dev_only: { default: agent },
    });

    core.setHeaders({ Authorization: "Bearer updated" });

    // Updating core headers must not wipe the agent's own header.
    expect(agent.headers).toMatchObject({
      "X-Agent": "agent-value",
      Authorization: "Bearer updated",
    });
  });

  it("re-surfaces the agent's own header when the core override is cleared (#5635)", () => {
    const agent = new HttpAgent({
      url: "https://runtime.example",
      headers: { Authorization: "Bearer agent-token" },
    });

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer core-token" },
      agents__unsafe_dev_only: { default: agent },
    });

    // Core overrides the agent's own Authorization on conflict.
    expect(agent.headers).toMatchObject({ Authorization: "Bearer core-token" });

    // Clearing the core override only drops core's value. The agent's own
    // construction-time header is the merge baseline, so it re-surfaces rather
    // than being removed — clearing an agent-level header is not possible via
    // setHeaders by design (see #5635).
    core.setHeaders({ Authorization: null });

    expect(agent.headers).toEqual({ Authorization: "Bearer agent-token" });
  });

  it("keeps the pristine baseline across remove + re-add (no core-header pollution) (#5635)", () => {
    const agent = new HttpAgent({ url: "https://runtime.example" });
    const core = new CopilotKitCore({ runtimeUrl: undefined });

    core.addAgent__unsafe_dev_only({ id: "x", agent });
    core.setHeaders({ Authorization: "Bearer core" });
    expect(agent.headers).toMatchObject({ Authorization: "Bearer core" });

    // The baseline is captured once (pristine, empty here) and never
    // re-captured, so removing then re-adding the same instance must not fold
    // the stale core Authorization into the agent's "own" headers.
    core.removeAgent__unsafe_dev_only("x");
    core.setHeaders({});
    core.addAgent__unsafe_dev_only({ id: "x", agent });

    expect("Authorization" in agent.headers).toBe(false);
  });

  it("applies updated headers to existing HttpAgent instances", () => {
    const agent = new HttpAgent({ url: "https://runtime.example" });

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer cfg" },
      agents__unsafe_dev_only: { default: agent },
    });

    expect(agent.headers).toMatchObject({
      Authorization: "Bearer cfg",
    });

    core.setHeaders({
      Authorization: "Bearer updated",
      "X-Trace": "123",
    });

    expect(agent.headers).toMatchObject({
      Authorization: "Bearer updated",
      "X-Trace": "123",
    });
  });

  it("applies headers to agents provided via setAgents", () => {
    const originalAgent = new HttpAgent({
      url: "https://runtime.example/original",
    });
    const replacementAgent = new HttpAgent({
      url: "https://runtime.example/replacement",
    });

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer cfg" },
      agents__unsafe_dev_only: { original: originalAgent },
    });

    expect(originalAgent.headers).toMatchObject({
      Authorization: "Bearer cfg",
    });

    core.setAgents__unsafe_dev_only({ replacement: replacementAgent });

    expect(replacementAgent.headers).toMatchObject({
      Authorization: "Bearer cfg",
    });
  });

  it("applies headers when agents are added dynamically", () => {
    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer cfg" },
    });

    const addedAgent = new HttpAgent({ url: "https://runtime.example/new" });

    core.setAgents__unsafe_dev_only({ added: addedAgent });

    expect(addedAgent.headers).toMatchObject({
      Authorization: "Bearer cfg",
    });
  });

  it("uses the latest headers when running HttpAgent instances", async () => {
    const recorded: Array<Record<string, string>> = [];

    class RecordingHttpAgent extends HttpAgent {
      constructor() {
        super({ url: "https://runtime.example" });
      }

      async runAgent(...args: Parameters<HttpAgent["runAgent"]>) {
        recorded.push({ ...this.headers });
        return Promise.resolve({
          result: undefined,
          newMessages: [],
        }) as ReturnType<HttpAgent["runAgent"]>;
      }
    }

    const agent = new RecordingHttpAgent();

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      headers: { Authorization: "Bearer initial" },
      agents__unsafe_dev_only: { default: agent },
    });

    await core.runAgent({ agent });

    core.setHeaders({ Authorization: "Bearer updated", "X-Trace": "123" });

    await core.runAgent({ agent });

    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ Authorization: "Bearer initial" });
    expect(recorded[1]).toMatchObject({
      Authorization: "Bearer updated",
      "X-Trace": "123",
    });
  });

  it("applies headers to remote agents fetched from runtime info", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        version: "1.0.0",
        agents: {
          remote: {
            name: "Remote Agent",
            className: "RemoteClass",
            description: "Remote description",
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      headers: { Authorization: "Bearer cfg", "X-Team": "angular" },
    });

    await waitForCondition(() => core.getAgent("remote") !== undefined);

    const remoteAgent = core.getAgent("remote") as HttpAgent | undefined;
    expect(remoteAgent).toBeDefined();
    expect(remoteAgent?.headers).toMatchObject({
      Authorization: "Bearer cfg",
      "X-Team": "angular",
    });

    core.setHeaders({ Authorization: "Bearer updated" });

    expect(remoteAgent?.headers).toMatchObject({
      Authorization: "Bearer updated",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example/info",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer cfg",
          "X-Team": "angular",
        }),
      }),
    );
  });

  it("drops headers whose value is null or undefined", () => {
    const core = new CopilotKitCore({
      headers: { Authorization: "Bearer initial", "X-Trace": "abc" },
    });

    core.setHeaders({
      Authorization: null,
      "X-Trace": undefined,
      "X-Keep": "kept",
    });

    expect(core.headers).toEqual({ "X-Keep": "kept" });
    expect("Authorization" in core.headers).toBe(false);
    expect("X-Trace" in core.headers).toBe(false);
  });

  it("clears a single header while preserving the rest via spread", () => {
    const core = new CopilotKitCore({
      headers: { Authorization: "Bearer token", "X-Team": "angular" },
    });

    // Logout pattern: spread current headers, clear just Authorization.
    core.setHeaders({ ...core.headers, Authorization: null });

    expect(core.headers).toEqual({ "X-Team": "angular" });
  });

  it("overwrites rather than merges — keys absent from the new set are dropped", () => {
    const agent = new HttpAgent({ url: "https://runtime.example" });
    const core = new CopilotKitCore({
      headers: { Authorization: "Bearer token", "X-Team": "angular" },
      agents__unsafe_dev_only: { default: agent },
    });

    // Without spreading the existing headers, "X-Team" is not carried over.
    core.setHeaders({ Authorization: "Bearer updated" });

    expect(core.headers).toEqual({ Authorization: "Bearer updated" });
    expect("X-Team" in agent.headers).toBe(false);
  });

  it("notifies subscribers with the cleared header set", () => {
    const core = new CopilotKitCore({
      headers: { Authorization: "Bearer token" },
    });

    const onHeadersChanged = vi.fn();
    core.subscribe({ onHeadersChanged });

    core.setHeaders({ Authorization: null });

    expect(onHeadersChanged).toHaveBeenCalledWith(
      expect.objectContaining({ headers: {} }),
    );
  });

  it("clears the header on registered agents when set to null", () => {
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: {
        local: new HttpAgent({ url: "https://runtime.example" }),
      },
      headers: { Authorization: "Bearer token" },
    });

    const agent = core.getAgent("local") as HttpAgent;
    expect(agent.headers).toMatchObject({ Authorization: "Bearer token" });

    core.setHeaders({ Authorization: null });

    expect("Authorization" in agent.headers).toBe(false);
  });

  it("keeps an empty-string header value rather than dropping the key", () => {
    const core = new CopilotKitCore({ headers: { Authorization: "Bearer x" } });

    // Only null/undefined clear a header; "" is a valid value and survives.
    core.setHeaders({ Authorization: "" });

    expect(core.headers).toEqual({ Authorization: "" });
  });

  it("clears the header on remote agents fetched from runtime info", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        version: "1.0.0",
        agents: {
          remote: {
            name: "Remote Agent",
            className: "RemoteClass",
            description: "Remote description",
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      headers: { Authorization: "Bearer token" },
    });

    await waitForCondition(() => core.getAgent("remote") !== undefined);

    const remoteAgent = core.getAgent("remote") as HttpAgent;
    // Remote agents are ProxiedCopilotRuntimeAgent (which extends HttpAgent),
    // so the clear propagates to them the same way it does to local agents.
    expect(remoteAgent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect(remoteAgent.headers).toMatchObject({
      Authorization: "Bearer token",
    });

    core.setHeaders({ Authorization: null });

    expect("Authorization" in remoteAgent.headers).toBe(false);
  });
});
