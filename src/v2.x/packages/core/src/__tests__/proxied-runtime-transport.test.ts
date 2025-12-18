import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";
import { createSuggestionsConfig, MockAgent } from "./test-utils";

type TransportMatrixEntry = {
  label: string;
  runtimeUrl: string;
  transport: "rest" | "single";
};

const TEST_MATRIX: TransportMatrixEntry[] = [
  {
    label: "Hono REST transport",
    runtimeUrl: "https://runtime.example/hono",
    transport: "rest",
  },
  {
    label: "Hono single-route transport",
    runtimeUrl: "https://runtime.example/hono-rpc",
    transport: "single",
  },
  {
    label: "Express REST transport",
    runtimeUrl: "https://runtime.example/express",
    transport: "rest",
  },
  {
    label: "Express single-route transport",
    runtimeUrl: "https://runtime.example/express-rpc",
    transport: "single",
  },
];

const encoder = new TextEncoder();

describe("ProxiedCopilotRuntimeAgent transport integration", () => {
  const originalFetch = global.fetch;

  TEST_MATRIX.forEach(({ label, runtimeUrl, transport }) => {
    describe(label, () => {
      let fetchMock: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        fetchMock = vi.fn();
        // @ts-expect-error - Node typings allow reassigning fetch in tests
        global.fetch = fetchMock;
      });

      afterEach(() => {
        vi.restoreAllMocks();
        global.fetch = originalFetch;
      });

      it("sends run requests with the expected payload", async () => {
        const agentId = "workflow-agent";
        const agent = new ProxiedCopilotRuntimeAgent({
          runtimeUrl,
          agentId,
          headers: { Authorization: "Bearer test-token" },
          transport,
        });

        fetchMock.mockResolvedValueOnce(createSseResponse());

        await expect(
          agent.runAgent({
            forwardedProps: { foo: "bar" },
          }),
        ).resolves.toMatchObject({
          newMessages: expect.any(Array),
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        if (transport === "rest") {
          expect(url).toBe(`${runtimeUrl}/agent/${encodeURIComponent(agentId)}/run`);
        } else {
          expect(url).toBe(runtimeUrl);
          const body = JSON.parse(init.body as string);
          expect(body).toMatchObject({
            method: "agent/run",
            params: {
              agentId,
            },
          });
        }

        expect(init.method).toBe("POST");
        const headers = new Headers(init.headers as HeadersInit);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("accept")).toBe("text/event-stream");
      });

      it("sends connect requests with the expected payload", async () => {
        const agentId = "connect-agent";
        const agent = new ProxiedCopilotRuntimeAgent({
          runtimeUrl,
          agentId,
          headers: { Authorization: "Bearer test-token" },
          transport,
        });

        fetchMock.mockResolvedValueOnce(createSseResponse());

        await expect(agent.connectAgent({})).resolves.toMatchObject({
          newMessages: expect.any(Array),
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        if (transport === "rest") {
          expect(url).toBe(`${runtimeUrl}/agent/${encodeURIComponent(agentId)}/connect`);
        } else {
          expect(url).toBe(runtimeUrl);
          const body = JSON.parse(init.body as string);
          expect(body).toMatchObject({
            method: "agent/connect",
            params: {
              agentId,
            },
          });
        }
        expect(init.method).toBe("POST");
        const headers = new Headers(init.headers as HeadersInit);
        expect(headers.get("accept")).toBe("text/event-stream");
      });

      it("sends stop requests with the expected payload", () => {
        const agentId = "stop-agent";
        const threadId = "thread-123";
        const agent = new ProxiedCopilotRuntimeAgent({
          runtimeUrl,
          agentId,
          headers: { Authorization: "Bearer test-token" },
          transport,
        });

        agent.threadId = threadId;
        fetchMock.mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
        agent.abortRun();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        if (transport === "rest") {
          expect(url).toBe(
            `${runtimeUrl}/agent/${encodeURIComponent(agentId)}/stop/${encodeURIComponent(threadId)}`,
          );
        } else {
          expect(url).toBe(runtimeUrl);
          const body = JSON.parse(init.body as string);
          expect(body).toMatchObject({
            method: "agent/stop",
            params: {
              agentId,
              threadId,
            },
          });
        }
        expect(init.method).toBe("POST");
        const headers = new Headers(init.headers as HeadersInit);
        expect(headers.get("content-type")).toBe("application/json");
      });
    });
  });
});

describe("ProxiedCopilotRuntimeAgent cloning", () => {
  const originalFetch = global.fetch;
  const runtimeUrl = "https://runtime.example/single";

  beforeEach(() => {
    // @ts-expect-error - Node typings allow reassigning fetch in tests
    global.fetch = vi.fn(() => Promise.resolve(createSseResponse()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("preserves single-endpoint envelope on cloned agents", async () => {
    const agentId = "clone-agent";
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl,
      agentId,
      transport: "single",
    });

    const cloned = agent.clone();
    await expect(cloned.runAgent({})).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(runtimeUrl);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      method: "agent/run",
      params: {
        agentId,
      },
    });
  });
});

describe("Suggestions engine with single-endpoint runtime agents", () => {
  const originalFetch = global.fetch;
  const runtimeUrl = "https://runtime.example/single";

  beforeEach(() => {
    // @ts-expect-error - Node typings allow reassigning fetch in tests
    global.fetch = vi.fn(() => Promise.resolve(createSseResponse()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("envelopes suggestion runs with method and params when cloning runtime agents", async () => {
    const providerAgent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl,
      agentId: "provider",
      transport: "single",
    });
    const consumerAgent = new MockAgent({ agentId: "consumer" }) as unknown as any;

    const core = new CopilotKitCore({
      runtimeUrl,
      runtimeTransport: "single",
      agents__unsafe_dev_only: {
        provider: providerAgent,
        consumer: consumerAgent,
      },
    });

    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "provider",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(runtimeUrl);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      method: "agent/run",
      params: {
        agentId: expect.any(String),
      },
    });
  });
});

function createSseResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const events = [
        {
          type: "RUN_STARTED",
          threadId: "test-thread",
          runId: "test-run",
        },
        {
          type: "RUN_FINISHED",
          threadId: "test-thread",
          runId: "test-run",
          result: { newMessages: [] },
        },
      ];
      const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("AgentRegistry runtime info requests", () => {
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

  const infoResponse = {
    version: "1.0.0",
    agents: {
      remote: {
        description: "Remote agent",
      },
    },
  };

  const matrix: TransportMatrixEntry[] = [
    {
      label: "REST runtime info",
      runtimeUrl: "https://runtime.example/rest",
      transport: "rest",
    },
    {
      label: "Single-route runtime info",
      runtimeUrl: "https://runtime.example/single",
      transport: "single",
    },
  ];

  matrix.forEach(({ label, runtimeUrl, transport }) => {
    it(`fetches runtime info correctly for ${label}`, async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(infoResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      // @ts-expect-error - override in test environment
      global.fetch = fetchMock;

      const core = new CopilotKitCore({
        runtimeUrl,
        runtimeTransport: transport,
        headers: { Authorization: "Bearer token" },
      });

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      if (transport === "rest") {
        expect(url).toBe(`${runtimeUrl}/info`);
        expect(init.method ?? "GET").toBe("GET");
      } else {
        expect(url).toBe(runtimeUrl);
        expect(init.method).toBe("POST");
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ method: "info" });
      }

      const headers = new Headers(init.headers as HeadersInit);
      expect(headers.get("Authorization")).toBe("Bearer token");

      // Ensure remote agent was registered using the chosen transport.
      const remoteAgent = core.getAgent("remote");
      expect(remoteAgent).toBeDefined();
      expect(remoteAgent?.agentId).toBe("remote");
    });
  });
});
