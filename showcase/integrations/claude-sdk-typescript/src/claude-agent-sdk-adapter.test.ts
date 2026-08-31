import type { RunAgentInput } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_FLIGHT_TOOL_SCHEMA,
  buildDisplayFlightOperations,
} from "./agent/a2ui-fixed-prompt";

const mocks = vi.hoisted(() => ({
  adapterConfigs: [] as Array<Record<string, unknown>>,
  runInputs: [] as unknown[],
  createSdkMcpServer: vi.fn(),
  sdkTool: vi.fn(),
}));

vi.mock("@ag-ui/claude-agent-sdk", () => ({
  ClaudeAgentAdapter: class MockClaudeAgentAdapter {
    headers?: Record<string, string>;

    constructor(config: Record<string, unknown>) {
      mocks.adapterConfigs.push(config);
    }

    run(input: unknown) {
      mocks.runInputs.push(input);
      return {
        subscribe({ complete }: { complete: () => void }) {
          complete();
        },
      };
    }
  },
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: mocks.createSdkMcpServer,
  tool: mocks.sdkTool,
}));

import {
  runWithClaudeAgentSdk,
  shouldUseClaudeAgentSdk,
} from "./claude-agent-sdk-adapter";

const originalAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;

function plainInput(): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "message-1", role: "user", content: "Find a flight" }],
    tools: [],
    context: [],
    forwardedProps: {},
  } as RunAgentInput;
}

function structuredInput(): RunAgentInput {
  return {
    ...plainInput(),
    messages: [
      {
        id: "message-1",
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              value: "https://example.com/a.png",
              mimeType: "image/png",
            },
          },
        ],
      },
    ],
  } as unknown as RunAgentInput;
}

describe("Claude Agent SDK request selection", () => {
  afterEach(() => {
    if (originalAnthropicBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = originalAnthropicBaseUrl;
    }
  });

  it("uses ClaudeAgentAdapter for a normal fixed-schema request", () => {
    delete process.env.ANTHROPIC_BASE_URL;

    expect(
      shouldUseClaudeAgentSdk({
        input: plainInput(),
        forwardedHeaders: {},
        runtimeToolCount: 0,
      }),
    ).toBe(true);
  });

  it.each([
    ["aimock context", { forwardedHeaders: { "x-aimock-context": "d6" } }],
    ["runtime tools", { runtimeToolCount: 1 }],
    ["extended thinking", { enableThinking: true }],
    [
      "structured user input",
      {
        input: structuredInput(),
      },
    ],
  ])("uses the direct fallback for %s", (_name, overrides) => {
    delete process.env.ANTHROPIC_BASE_URL;

    expect(
      shouldUseClaudeAgentSdk({
        input: plainInput(),
        forwardedHeaders: {},
        runtimeToolCount: 0,
        ...overrides,
      }),
    ).toBe(false);
  });

  it("uses the direct fallback for an aimock base URL", () => {
    process.env.ANTHROPIC_BASE_URL = "http://aimock:4000";

    expect(
      shouldUseClaudeAgentSdk({
        input: plainInput(),
        forwardedHeaders: {},
        runtimeToolCount: 0,
      }),
    ).toBe(false);
  });
});

describe("Claude Agent SDK MCP tool wiring", () => {
  beforeEach(() => {
    mocks.adapterConfigs.length = 0;
    mocks.runInputs.length = 0;
    mocks.createSdkMcpServer.mockReset();
    mocks.sdkTool.mockReset();
    mocks.sdkTool.mockImplementation(
      (
        name: string,
        description: string,
        inputSchema: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => ({ name, description, inputSchema, handler }),
    );
    mocks.createSdkMcpServer.mockImplementation((config) => ({
      kind: "sdk-mcp-server",
      ...config,
    }));
  });

  it("registers display_flight through MCP and returns A2UI operations", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(
      async (toolName: string, toolInput: Record<string, unknown>) => ({
        resultText: JSON.stringify(
          buildDisplayFlightOperations(
            toolInput as {
              origin: string;
              destination: string;
              airline: string;
              price: string;
            },
          ),
        ),
        state: null,
      }),
    );

    await runWithClaudeAgentSdk({
      input: plainInput(),
      emit,
      runId: "run-1",
      threadId: "thread-1",
      systemPrompt: "Use display_flight.",
      toolSchemas: [DISPLAY_FLIGHT_TOOL_SCHEMA],
      initialState: {},
      model: "claude-sonnet-4.6",
      executeTool,
    });

    expect(mocks.adapterConfigs).toHaveLength(1);
    expect(mocks.adapterConfigs[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      allowedTools: ["mcp__copilotkit__display_flight"],
      mcpServers: {
        copilotkit: expect.objectContaining({
          kind: "sdk-mcp-server",
          name: "copilotkit",
          version: "1.0.0",
        }),
      },
    });

    const serverConfig = mocks.createSdkMcpServer.mock.calls[0]?.[0] as {
      tools: Array<{
        name: string;
        handler: (args: Record<string, unknown>) => Promise<{
          content: Array<{ type: string; text: string }>;
        }>;
      }>;
    };
    expect(serverConfig.tools).toHaveLength(1);
    expect(serverConfig.tools[0]?.name).toBe("display_flight");

    const flight = {
      origin: "SFO",
      destination: "JFK",
      airline: "United",
      price: "$289",
    };
    const result = await serverConfig.tools[0]!.handler(flight);

    expect(executeTool).toHaveBeenCalledWith(
      "display_flight",
      flight,
      {},
      emit,
    );
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      a2ui_operations: [
        { createSurface: expect.any(Object) },
        { updateComponents: expect.any(Object) },
        { updateDataModel: { value: flight } },
      ],
    });
  });
});
