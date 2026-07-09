import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { CopilotRuntime } from "../core/runtime";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import type {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
} from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { TranscriptionService } from "../transcription-service/transcription-service";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

// Mock transcription service
class MockTranscriptionService extends TranscriptionService {
  async transcribeFile(): Promise<string> {
    return "Mock transcription result";
  }
}

describe("handleGetRuntimeInfo", () => {
  const mockRequest = new Request("https://example.com/info");
  const inMemoryThreadEndpoints = {
    list: true,
    inspect: true,
    mutations: false,
    realtimeMetadata: false,
  };
  const createRunner = (supportsLocalThreadEndpoints = false) =>
    ({
      ...(supportsLocalThreadEndpoints
        ? { ɵsupportsLocalThreadEndpoints: true }
        : {}),
      run: vi.fn(),
      connect: vi.fn(),
      isRunning: vi.fn(),
      stop: vi.fn(),
    }) as unknown as AgentRunner;
  const createRuntimeLike = (
    overrides: Partial<CopilotRuntimeLike>,
  ): CopilotRuntimeLike =>
    ({
      agents: {},
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      runner: createRunner(),
      a2ui: undefined,
      mcpApps: undefined,
      openGenerativeUI: undefined,
      mode: "sse",
      debug: {
        enabled: false,
        events: false,
        lifecycle: false,
        verbose: false,
      },
      ...overrides,
    }) as unknown as CopilotRuntimeLike;
  const createIntelligenceRuntimeLike = (
    overrides: Partial<CopilotIntelligenceRuntimeLike> = {},
  ): CopilotIntelligenceRuntimeLike => ({
    agents: {},
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner: createRunner(),
    a2ui: undefined,
    mcpApps: undefined,
    openGenerativeUI: undefined,
    mode: "intelligence",
    debug: { enabled: false, events: false, lifecycle: false, verbose: false },
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "test-key",
    }),
    identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "User One" }),
    generateThreadNames: true,
    lockTtlSeconds: 20,
    lockHeartbeatIntervalSeconds: 15,
    bots: [],
    ...overrides,
  });

  it("should return runtime info with audioFileTranscriptionEnabled=false when no transcription service", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
      // No transcriptionService provided
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      version: expect.any(String),
      agents: {},
      audioFileTranscriptionEnabled: false,
      mode: "sse",
      threadEndpoints: inMemoryThreadEndpoints,
      suggestions: true,
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
      telemetryDisabled: false,
    });
  });

  it("should return runtime info with audioFileTranscriptionEnabled=true when transcription service is configured", async () => {
    const mockTranscriptionService = new MockTranscriptionService();
    const runtime = new CopilotRuntime({
      agents: {},
      transcriptionService: mockTranscriptionService,
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      version: expect.any(String),
      agents: {},
      audioFileTranscriptionEnabled: true,
      mode: "sse",
      threadEndpoints: inMemoryThreadEndpoints,
      suggestions: true,
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
      telemetryDisabled: false,
    });
  });

  it("should include agents information along with audioFileTranscriptionEnabled", async () => {
    const mockAgent = {
      description: "Test agent description",
      constructor: { name: "TestAgent" },
    };

    const runtime = new CopilotRuntime({
      agents: {
        testAgent: mockAgent as AbstractAgent,
      },
      transcriptionService: new MockTranscriptionService(),
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      version: expect.any(String),
      agents: {
        testAgent: {
          name: "testAgent",
          description: "Test agent description",
          className: "TestAgent",
        },
      },
      audioFileTranscriptionEnabled: true,
      mode: "sse",
      threadEndpoints: inMemoryThreadEndpoints,
      suggestions: true,
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
      telemetryDisabled: false,
    });
  });

  it("advertises the stateless suggestions capability", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.suggestions).toBe(true);
  });

  it("advertises suggestions for an Intelligence runtime", async () => {
    const runtime = createIntelligenceRuntimeLike();

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
      threadEndpointsEnabled: true,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.suggestions).toBe(true);
  });

  it("detects local thread endpoints from the runner capability flag", async () => {
    const runtime = createRuntimeLike({
      runner: createRunner(true),
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
      threadEndpointsEnabled: true,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.threadEndpoints).toEqual(inMemoryThreadEndpoints);
  });

  it("reports no thread endpoints when multi-route REST endpoints are disabled", async () => {
    const runtime = createRuntimeLike({
      runner: createRunner(true),
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
      threadEndpointsEnabled: false,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.threadEndpoints).toEqual({
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    });
  });

  it("does not advertise thread endpoints for a plain runner", async () => {
    const runtime = createRuntimeLike({
      runner: createRunner(false),
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
      threadEndpointsEnabled: true,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.threadEndpoints).toEqual({
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    });
  });

  it("reports all Intelligence thread endpoints when multi-route REST endpoints are enabled", async () => {
    const runtime = createIntelligenceRuntimeLike();

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
      threadEndpointsEnabled: true,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.threadEndpoints).toEqual({
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: true,
    });
    expect(data.intelligence).toEqual({
      wsUrl: "wss://runtime.example/client",
    });
  });

  it("should return a2uiEnabled: true when runtime has a2ui configured", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
      a2ui: {},
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.a2uiEnabled).toBe(true);
    expect(data.a2ui).toEqual({ enabled: true });
  });

  it("should forward per-agent a2ui scoping in the a2ui info object", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
      a2ui: { agents: ["agentic_chat", "tool_based_generative_ui"] },
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.a2uiEnabled).toBe(true);
    expect(data.a2ui).toEqual({
      enabled: true,
      agents: ["agentic_chat", "tool_based_generative_ui"],
    });
  });

  it("should omit the a2ui info object when a2ui is not configured", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.a2uiEnabled).toBe(false);
    expect(data.a2ui).toBeUndefined();
  });

  it("should return a2uiEnabled: false when a2ui is explicitly disabled", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
      a2ui: { enabled: false },
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.a2uiEnabled).toBe(false);
  });

  it("should include capabilities when agent implements getCapabilities", async () => {
    const mockCapabilities = {
      tools: { supported: true, clientProvided: true },
      transport: { streaming: true },
    };

    const mockAgent = {
      description: "Capable agent",
      constructor: { name: "CapableAgent" },
      getCapabilities: async () => mockCapabilities,
    };

    const runtime = new CopilotRuntime({
      agents: {
        capableAgent: mockAgent as unknown as AbstractAgent,
      },
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.agents.capableAgent.capabilities).toEqual(mockCapabilities);
  });

  it("should omit capabilities when agent does not implement getCapabilities", async () => {
    const mockAgent = {
      description: "Basic agent",
      constructor: { name: "BasicAgent" },
    };

    const runtime = new CopilotRuntime({
      agents: {
        basicAgent: mockAgent as unknown as AbstractAgent,
      },
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.agents.basicAgent.capabilities).toBeUndefined();
  });

  it("should include empty capabilities object when getCapabilities returns {}", async () => {
    const mockAgent = {
      description: "Empty caps agent",
      constructor: { name: "EmptyCapsAgent" },
      getCapabilities: async () => ({}),
    };

    const runtime = new CopilotRuntime({
      agents: {
        emptyAgent: mockAgent as unknown as AbstractAgent,
      },
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    // {} is truthy, so it should be included in the response
    expect(data.agents.emptyAgent.capabilities).toEqual({});
  });

  it("should isolate per-agent getCapabilities failures and log a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const failingAgent = {
      description: "Failing agent",
      constructor: { name: "FailingAgent" },
      getCapabilities: async () => {
        throw new Error("capability fetch failed");
      },
    };

    const healthyAgent = {
      description: "Healthy agent",
      constructor: { name: "HealthyAgent" },
      getCapabilities: async () => ({
        tools: { supported: true },
      }),
    };

    const runtime = new CopilotRuntime({
      agents: {
        failing: failingAgent as unknown as AbstractAgent,
        healthy: healthyAgent as unknown as AbstractAgent,
      },
    });

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    // Failing agent should still appear but without capabilities
    expect(data.agents.failing).toEqual({
      name: "failing",
      description: "Failing agent",
      className: "FailingAgent",
    });
    expect(data.agents.failing.capabilities).toBeUndefined();

    // Healthy agent should have its capabilities
    expect(data.agents.healthy.capabilities).toEqual({
      tools: { supported: true },
    });

    // Error should be logged, not silently swallowed
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to fetch capabilities for agent "failing":',
      "capability fetch failed",
    );

    warnSpy.mockRestore();
  });

  describe("telemetryDisabled", () => {
    beforeEach(() => {
      delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
      delete process.env.DO_NOT_TRACK;
    });

    afterEach(() => {
      delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
      delete process.env.DO_NOT_TRACK;
    });

    it("returns telemetryDisabled: false when env var is not set", async () => {
      const runtime = new CopilotRuntime({ agents: {} });
      const response = await handleGetRuntimeInfo({
        runtime,
        request: mockRequest,
      });
      const data = await response.json();
      expect(data.telemetryDisabled).toBe(false);
    });

    it("returns telemetryDisabled: true when COPILOTKIT_TELEMETRY_DISABLED=true", async () => {
      process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
      const runtime = new CopilotRuntime({ agents: {} });
      const response = await handleGetRuntimeInfo({
        runtime,
        request: mockRequest,
      });
      const data = await response.json();
      expect(data.telemetryDisabled).toBe(true);
    });

    it("returns telemetryDisabled: true when COPILOTKIT_TELEMETRY_DISABLED=1", async () => {
      process.env.COPILOTKIT_TELEMETRY_DISABLED = "1";
      const runtime = new CopilotRuntime({ agents: {} });
      const response = await handleGetRuntimeInfo({
        runtime,
        request: mockRequest,
      });
      const data = await response.json();
      expect(data.telemetryDisabled).toBe(true);
    });

    it("returns telemetryDisabled: true when DO_NOT_TRACK=1", async () => {
      process.env.DO_NOT_TRACK = "1";
      const runtime = new CopilotRuntime({ agents: {} });
      const response = await handleGetRuntimeInfo({
        runtime,
        request: mockRequest,
      });
      const data = await response.json();
      expect(data.telemetryDisabled).toBe(true);
    });
  });

  it("should return 500 error when runtime.agents throws an error", async () => {
    const runtime = {
      get agents(): Record<string, AbstractAgent> {
        throw new Error("Failed to get agents");
      },
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      mode: "sse",
    } as CopilotRuntime;

    const response = await handleGetRuntimeInfo({
      runtime,
      request: mockRequest,
    });

    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data).toEqual({
      error: "Failed to retrieve runtime information",
      message: "Failed to get agents",
    });
  });
});
