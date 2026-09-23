import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  toolCall,
  toolResult,
  finish,
  collectEvents,
} from "../../../../agent/__tests__/test-helpers";
import { CopilotRuntime } from "../copilot-runtime";
import { resolveAgents } from "../../../../v2/runtime/core/runtime";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

const input: RunAgentInput = {
  threadId: "t1",
  runId: "r1",
  messages: [],
  tools: [],
  context: [],
  state: {},
};

/**
 * Drives a v1 `actions` config all the way through BuiltInAgent: resolve the
 * agent, run it, pull the tool the AI SDK received, invoke it the way the SDK
 * would, and feed the output back as a tool-result so the TOOL_CALL_RESULT
 * event is built by the real emission path.
 */
async function runActionThroughAgent(actions: any) {
  const runtime = new CopilotRuntime({
    agents: {},
    actions,
  } as any);
  runtime.handleServiceAdapter({
    name: "OpenAIAdapter",
    provider: "openai",
    model: "gpt-4o",
  } as any);
  // Agents resolve per request, so this drives the factory with the request a
  // browser would send.
  const resolved: any = await resolveAgents(
    runtime.instance.agents,
    new Request("https://app.example.com/api/copilotkit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], forwardedProps: {} }),
    }),
  );
  const agent = resolved.default;

  vi.mocked(streamText).mockReturnValue(
    mockStreamTextResponse([finish()]) as any,
  );
  await collectEvents(agent["run"](input));

  // The tool the AI SDK actually received.
  const sdkTools = vi.mocked(streamText).mock.calls[0][0].tools as any;
  const sdkTool = sdkTools.greet;

  // The AI SDK calls `execute` itself. Do exactly that, then replay the
  // output through the real tool-result emission path.
  const output = await sdkTool.execute({ name: "Ada" });

  vi.mocked(streamText).mockReturnValue(
    mockStreamTextResponse([
      toolCall("call-1", "greet", { name: "Ada" }),
      toolResult("call-1", "greet", output),
      finish(),
    ]) as any,
  );
  const events = await collectEvents(agent["run"](input));

  return {
    output,
    result: events.find((e) => e.type === EventType.TOOL_CALL_RESULT) as any,
  };
}

describe("v1 actions end to end through BuiltInAgent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the handler and emits a TOOL_CALL_RESULT with string content", async () => {
    const handler = vi.fn().mockResolvedValue({ greeting: "hi Ada" });
    const { result } = await runActionThroughAgent([
      {
        name: "greet",
        description: "greet",
        parameters: [{ name: "name", type: "string" }],
        handler,
      },
    ]);

    expect(handler).toHaveBeenCalledWith({ name: "Ada" });
    expect(result).toBeDefined();
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("hi Ada");
  });

  it("emits string content even for a handler that returns nothing", async () => {
    const { result } = await runActionThroughAgent([
      {
        name: "greet",
        description: "greet",
        parameters: [],
        handler: () => {},
      },
    ]);

    expect(typeof result.content).toBe("string");
  });
});
