import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createTool,
  createToolCallMessage,
  getToolMessage,
} from "./test-utils";

/**
 * A tool handler that throws answers its call with a tool message whose
 * content reads "Error: …". The message also carries the AG-UI `error` field,
 * so a UI can show the call as failed without parsing the content.
 */
describe("tool messages for failed tool calls", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  const addAgent = (agent: MockAgent) =>
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

  it("sets error when a frontend tool throws during an agent run", async () => {
    copilotKitCore.addTool(
      createTool({
        name: "explodes",
        handler: vi.fn(async () => {
          throw new Error("Disk full");
        }),
        followUp: false,
      }),
    );
    const agent = new MockAgent({
      agentId: "default",
      newMessages: [createToolCallMessage("explodes")],
    });
    addAgent(agent);

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolMessage = getToolMessage(
      agent.messages.find((m) => m.role === "tool"),
    );
    expect(toolMessage.content).toBe("Error: Disk full");
    expect(toolMessage.error).toBe("Disk full");
  });

  it("leaves error unset when the tool succeeds", async () => {
    copilotKitCore.addTool(
      createTool({
        name: "works",
        handler: vi.fn(async () => "ok"),
        followUp: false,
      }),
    );
    const agent = new MockAgent({
      agentId: "default",
      newMessages: [createToolCallMessage("works")],
    });
    addAgent(agent);

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolMessage = getToolMessage(
      agent.messages.find((m) => m.role === "tool"),
    );
    expect(toolMessage.content).toBe("ok");
    expect("error" in toolMessage).toBe(false);
  });

  it("sets error when runTool's handler throws", async () => {
    copilotKitCore.addTool(
      createTool({
        name: "explodes",
        handler: vi.fn(async () => {
          throw new Error("Handler exploded");
        }),
        followUp: false,
      }),
    );
    const agent = new MockAgent({ agentId: "default" });
    addAgent(agent);

    const { toolCallId } = await copilotKitCore.runTool({ name: "explodes" });

    const toolMessage = getToolMessage(
      agent.messages.find(
        (m) => m.role === "tool" && m.toolCallId === toolCallId,
      ),
    );
    expect(toolMessage.error).toBe("Handler exploded");
  });
});
