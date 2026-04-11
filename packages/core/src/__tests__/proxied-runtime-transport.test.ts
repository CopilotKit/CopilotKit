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
          expect(url).toBe(
            `${runtimeUrl}/agent/${encodeURIComponent(agentId)}/run`,
          );
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
          expect(url).toBe(
            `${runtimeUrl}/agent/${encodeURIComponent(agentId)}/connect`,
          );
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

describe("ProxiedCopilotRuntimeAgent capabilities", () => {
  const capabilitiesFixture = {
    tools: { supported: true, clientProvided: true },
    transport: { streaming: true },
  };

  it("returns capabilities from the getter when constructed with capabilities", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      description: "Test agent",
      capabilities: capabilitiesFixture,
    });

    expect(agent.capabilities).toEqual(capabilitiesFixture);
  });

  it("returns capabilities from getCapabilities() when constructed with capabilities", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      description: "Test agent",
      capabilities: capabilitiesFixture,
    });

    await expect(agent.getCapabilities()).resolves.toEqual(capabilitiesFixture);
  });

  it("returns undefined from the getter when constructed without capabilities", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      description: "Test agent",
    });

    expect(agent.capabilities).toBeUndefined();
  });

  it("returns {} from getCapabilities() when constructed without capabilities", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      description: "Test agent",
    });

    await expect(agent.getCapabilities()).resolves.toEqual({});
  });

  it("clone() preserves capabilities", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:3000",
      agentId: "test-agent",
      description: "Test agent",
      capabilities: capabilitiesFixture,
    });

    const cloned = agent.clone();
    expect(cloned.capabilities).toEqual(capabilitiesFixture);
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
    const consumerAgent = new MockAgent({
      agentId: "consumer",
    }) as unknown as any;

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
      const payload = events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("Auto-detect transport from runtime info response", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  const infoResponse = {
    version: "1.0.0",
    agents: {
      remote: {
        description: "Remote agent",
      },
    },
  };

  beforeEach(() => {
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

  it("auto-detects REST transport when GET /info succeeds", async () => {
    const runtimeUrl = "https://runtime.example/rest-auto";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(infoResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    // No runtimeTransport specified — defaults to "auto"
    const core = new CopilotKitCore({
      runtimeUrl,
      headers: { Authorization: "Bearer token" },
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Should have tried REST first (GET /info)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${runtimeUrl}/info`);
    expect(init.method ?? "GET").toBe("GET");

    // Remote agent should be registered
    const remoteAgent = core.getAgent("remote");
    expect(remoteAgent).toBeDefined();
    expect(remoteAgent?.agentId).toBe("remote");

    // Transport should have been resolved to "rest"
    expect(core.runtimeTransport).toBe("rest");
  });

  it("auto-detects single-endpoint transport when GET /info fails", async () => {
    const runtimeUrl = "https://runtime.example/single-auto";
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        // REST attempt: GET /info → 404
        if (
          typeof url === "string" &&
          url.endsWith("/info") &&
          (!init?.method || init.method === "GET")
        ) {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        }
        // Single-endpoint attempt: POST with { method: "info" }
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify(infoResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    // No runtimeTransport specified — defaults to "auto"
    const core = new CopilotKitCore({
      runtimeUrl,
      headers: { Authorization: "Bearer token" },
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // First call should be REST attempt (GET /info)
    const [url1] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url1).toBe(`${runtimeUrl}/info`);

    // Second call should be single-endpoint attempt (POST with { method: "info" })
    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe(runtimeUrl);
    expect(init2.method).toBe("POST");
    const body = JSON.parse(init2.body as string);
    expect(body).toEqual({ method: "info" });

    // Remote agent should be registered
    const remoteAgent = core.getAgent("remote");
    expect(remoteAgent).toBeDefined();
    expect(remoteAgent?.agentId).toBe("remote");

    // Transport should have been resolved to "single"
    expect(core.runtimeTransport).toBe("single");
  });

  it("explicit transport='single' flag still works without auto-detection", async () => {
    const runtimeUrl = "https://runtime.example/explicit-single";
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
      runtimeTransport: "single",
      headers: { Authorization: "Bearer token" },
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Should have gone directly to single-endpoint (POST with { method: "info" })
    // without trying REST first
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(runtimeUrl);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ method: "info" });

    // Remote agent should be registered
    const remoteAgent = core.getAgent("remote");
    expect(remoteAgent).toBeDefined();
    expect(remoteAgent?.agentId).toBe("remote");

    // Transport stays "single"
    expect(core.runtimeTransport).toBe("single");
  });

  it("explicit transport='rest' flag still works without auto-detection", async () => {
    const runtimeUrl = "https://runtime.example/explicit-rest";
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
      runtimeTransport: "rest",
      headers: { Authorization: "Bearer token" },
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Should have gone directly to REST (GET /info) without trying single
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${runtimeUrl}/info`);
    expect(init.method ?? "GET").toBe("GET");

    // Remote agent should be registered
    const remoteAgent = core.getAgent("remote");
    expect(remoteAgent).toBeDefined();

    // Transport stays "rest"
    expect(core.runtimeTransport).toBe("rest");
  });
});

describe("Auto-detect transport edge cases (AgentRegistry)", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  const infoResponse = {
    version: "1.0.0",
    agents: {
      remote: {
        description: "Remote agent",
      },
    },
  };

  beforeEach(() => {
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

  it("falls back to single-endpoint when REST probe returns 500 with JSON body", async () => {
    const runtimeUrl = "https://runtime.example/auto-500";
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        // REST attempt: GET /info → 500 with a JSON error body.
        // The bug: without the fix, the code treats any non-404/405 as REST
        // and parses this JSON as RuntimeInfo, corrupting the agent list.
        if (
          typeof url === "string" &&
          url.endsWith("/info") &&
          (!init?.method || init.method === "GET")
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Internal Server Error" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        // Single-endpoint attempt: POST with { method: "info" }
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify(infoResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    const core = new CopilotKitCore({ runtimeUrl });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // First call: REST (GET /info → 500)
    const [url1] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url1).toBe(`${runtimeUrl}/info`);

    // Second call: single-endpoint (POST)
    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe(runtimeUrl);
    expect(init2.method).toBe("POST");

    // Agent registered, transport resolved to "single"
    expect(core.getAgent("remote")).toBeDefined();
    expect(core.runtimeTransport).toBe("single");
  });

  it("falls back to single-endpoint when REST probe returns 403", async () => {
    const runtimeUrl = "https://runtime.example/auto-403";
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.endsWith("/info") &&
          (!init?.method || init.method === "GET")
        ) {
          return Promise.resolve(new Response("Forbidden", { status: 403 }));
        }
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify(infoResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    const core = new CopilotKitCore({ runtimeUrl });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(core.getAgent("remote")).toBeDefined();
    expect(core.runtimeTransport).toBe("single");
  });

  it("falls back to single-endpoint when REST probe throws a network error", async () => {
    const runtimeUrl = "https://runtime.example/auto-net-err";
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.endsWith("/info") &&
          (!init?.method || init.method === "GET")
        ) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify(infoResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    const core = new CopilotKitCore({ runtimeUrl });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(core.getAgent("remote")).toBeDefined();
    expect(core.runtimeTransport).toBe("single");
  });

  it("reports error when both REST and single-endpoint probes fail", async () => {
    const runtimeUrl = "https://runtime.example/auto-both-fail";
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.endsWith("/info") &&
          (!init?.method || init.method === "GET")
        ) {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        }
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response("Internal Server Error", { status: 500 }),
          );
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    const errorSpy = vi.fn();
    const core = new CopilotKitCore({ runtimeUrl });
    core.subscribe({
      onError: errorSpy,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Should have emitted an error since single-endpoint also returned 500
    // The connection status should be Error
    await vi.waitFor(() => {
      expect(core.runtimeConnectionStatus).toBe("error");
    });
  });

  it("falls back to single-endpoint when REST probe returns 405", async () => {
    const runtimeUrl = "https://runtime.example/auto-405";
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.endsWith("/info") &&
          (!init?.method || init.method === "GET")
        ) {
          return Promise.resolve(
            new Response("Method Not Allowed", { status: 405 }),
          );
        }
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify(infoResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });
    // @ts-expect-error - override in test environment
    global.fetch = fetchMock;

    const core = new CopilotKitCore({ runtimeUrl });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(core.getAgent("remote")).toBeDefined();
    expect(core.runtimeTransport).toBe("single");
  });
});

describe("ProxiedCopilotRuntimeAgent construction and defaults", () => {
  it("defaults transport to 'auto' when not specified", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/default",
      agentId: "test-agent",
    });
    // The agent should have been created without throwing.
    // When transport is "auto", the URL is set as REST-style initially.
    expect(agent).toBeDefined();
    expect(agent.agentId).toBe("test-agent");
  });

  it("normalizes trailing slashes on runtimeUrl", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/trailing/",
      agentId: "test-agent",
      transport: "rest",
    });
    expect(agent.runtimeUrl).toBe("https://runtime.example/trailing");
  });
});

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
