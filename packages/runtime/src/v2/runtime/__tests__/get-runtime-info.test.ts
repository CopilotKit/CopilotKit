import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { CopilotRuntime } from "../core/runtime";
import { TranscriptionService } from "../transcription-service/transcription-service";
import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

// Mock transcription service
class MockTranscriptionService extends TranscriptionService {
  async transcribeFile(): Promise<string> {
    return "Mock transcription result";
  }
}

describe("handleGetRuntimeInfo", () => {
  const mockRequest = new Request("https://example.com/info");

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
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
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
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
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
      a2uiEnabled: false,
      openGenerativeUIEnabled: false,
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
