import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { CopilotRuntime } from "../runtime";
import { TranscriptionService } from "../transcription-service/transcription-service";
import { describe, it, expect } from "vitest";
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
      a2uiEnabled: false,
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
      a2uiEnabled: false,
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
      a2uiEnabled: false,
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

  it("should return 500 error when runtime.agents throws an error", async () => {
    const runtime = {
      get agents(): Record<string, AbstractAgent> {
        throw new Error("Failed to get agents");
      },
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
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
