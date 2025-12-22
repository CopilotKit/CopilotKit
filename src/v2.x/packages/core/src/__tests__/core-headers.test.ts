import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
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
      delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
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
      })
    );
  });

  it("uses updated headers for subsequent runtime requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
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
        return Promise.resolve({ newMessages: [] }) as ReturnType<HttpAgent["connectAgent"]>;
      }

      async runAgent(...args: Parameters<HttpAgent["runAgent"]>) {
        recorded.push({ ...this.headers });
        return Promise.resolve({ newMessages: [] }) as ReturnType<HttpAgent["runAgent"]>;
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
    const originalAgent = new HttpAgent({ url: "https://runtime.example/original" });
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
        return Promise.resolve({ newMessages: [] }) as ReturnType<HttpAgent["runAgent"]>;
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
      })
    );
  });
});
