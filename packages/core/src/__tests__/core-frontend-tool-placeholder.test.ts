import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createToolCallMessage,
  createToolResultMessage,
  createTool,
} from "./test-utils";

describe("CopilotKitCore - Frontend Tool Placeholder (remote agent HITL)", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute handler and replace placeholder when backend returns a placeholder result", async () => {
    const handler = vi.fn(async () => "Real result");
    const tool = createTool({ name: "myTool", handler, followUp: false });
    copilotKitCore.addTool(tool);

    const toolCallMsg = createToolCallMessage("myTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const placeholder = createToolResultMessage(
      toolCallId,
      "Forwarded to client",
    );

    const agent = new MockAgent({ newMessages: [toolCallMsg, placeholder] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // Handler was called
    expect(handler).toHaveBeenCalledOnce();

    // The real result message should be present; the placeholder must be gone
    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as any).content).not.toBe("Forwarded to client");
  });

  it("should preserve placeholder and skip execution when tool has no handler", async () => {
    // A tool definition without a handler represents a backend-only tool
    const tool = createTool({
      name: "backendTool",
      handler: undefined,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const toolCallMsg = createToolCallMessage("backendTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const placeholder = createToolResultMessage(
      toolCallId,
      "Forwarded to client",
    );

    const agent = new MockAgent({ newMessages: [toolCallMsg, placeholder] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // The placeholder should remain untouched
    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as any).content).toBe("Forwarded to client");
  });

  it("should execute handler normally when no existing result (BuiltInAgent regression)", async () => {
    const handler = vi.fn(async () => "Result");
    const tool = createTool({ name: "localTool", handler, followUp: false });
    copilotKitCore.addTool(tool);

    // No placeholder — mirrors BuiltInAgent / Vercel AI SDK behaviour
    const toolCallMsg = createToolCallMessage("localTool");
    const agent = new MockAgent({ newMessages: [toolCallMsg] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(handler).toHaveBeenCalledOnce();

    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
  });

  it("should invoke wildcard handler when no specific tool is registered and no existing result", async () => {
    const wildcardHandler = vi.fn(async () => "Wildcard result");
    const wildcardTool = createTool({
      name: "*",
      handler: wildcardHandler,
      followUp: false,
    });
    copilotKitCore.addTool(wildcardTool);

    const toolCallMsg = createToolCallMessage("unknownTool");
    const agent = new MockAgent({ newMessages: [toolCallMsg] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(wildcardHandler).toHaveBeenCalledOnce();
  });
});
