import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ContentPart } from "@ag-ui/client";
import { CopilotKitCore } from "../core";
import { MockAgent, createToolCallMessage, createTool } from "./test-utils";

const IMAGE_PARTS: ContentPart[] = [
  { type: "text", text: "Here is the chart." },
  {
    type: "image",
    source: { type: "data", value: "iVBORw0KGgo=", mimeType: "image/png" },
  },
];

function toolMessages(agent: MockAgent) {
  return agent.messages.filter((m) => m.role === "tool");
}

describe("CopilotKitCore - tool handlers that return content parts", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  async function runWithTool(name: string, handlerResult: unknown) {
    core.addTool(
      createTool({
        name,
        handler: vi.fn(async () => handlerResult),
        followUp: false,
      }),
    );
    const agent = new MockAgent({
      newMessages: [createToolCallMessage(name)],
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    await core.runAgent({ agent: agent as any });
    return agent;
  }

  it("passes a ContentPart[] result through as the tool message content", async () => {
    const agent = await runWithTool("chart", IMAGE_PARTS);

    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toEqual(IMAGE_PARTS);
  });

  it("still stringifies a plain object result", async () => {
    const agent = await runWithTool("lookup", { temperature: 21 });

    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toBe('{"temperature":21}');
  });

  it("still stringifies an array that is not content parts", async () => {
    const agent = await runWithTool("list", [{ type: "row", id: 1 }]);

    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toBe('[{"type":"row","id":1}]');
  });

  it("still stringifies an array with a part the AG-UI schema rejects", async () => {
    // The runtime parses the request with the same schema, and one invalid
    // part there fails the whole run. A data source needs a mimeType.
    const parts = [
      { type: "text", text: "ok" },
      { type: "image", source: { type: "data", value: "iVBORw0KGgo=" } },
    ];
    const agent = await runWithTool("broken", parts);

    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toBe(JSON.stringify(parts));
  });

  it("still stringifies an empty array", async () => {
    const agent = await runWithTool("empty", []);

    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toBe("[]");
  });

  it("passes content parts through for the wildcard tool", async () => {
    core.addTool({
      name: "*",
      handler: vi.fn(async () => IMAGE_PARTS),
      followUp: false,
    });
    const agent = new MockAgent({
      newMessages: [createToolCallMessage("unregistered")],
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    await core.runAgent({ agent: agent as any });

    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toEqual(IMAGE_PARTS);
  });

  it("keeps runTool and onToolExecutionEnd results as strings", async () => {
    core.addTool(
      createTool({
        name: "chart",
        handler: vi.fn(async () => IMAGE_PARTS),
        followUp: false,
      }),
    );
    const agent = new MockAgent({ agentId: "default" });
    core.addAgent__unsafe_dev_only({ id: "default", agent: agent as any });
    const onToolExecutionEnd = vi.fn();
    core.subscribe({ onToolExecutionEnd });

    const result = await core.runTool({ name: "chart", parameters: {} });

    expect(result.result).toBe(JSON.stringify(IMAGE_PARTS));
    expect(onToolExecutionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ result: JSON.stringify(IMAGE_PARTS) }),
    );
    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toEqual(IMAGE_PARTS);
  });

  it("reports a content-part result that cannot be serialized as a tool error", async () => {
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;
    core.addTool(
      createTool({
        name: "circular",
        handler: vi.fn(async () => [{ type: "text", text: "hi", metadata }]),
        followUp: false,
      }),
    );
    const agent = new MockAgent({ agentId: "default" });
    core.addAgent__unsafe_dev_only({ id: "default", agent: agent as any });

    const result = await core.runTool({ name: "circular", parameters: {} });

    expect(result.error).toMatch(/circular/i);
    const [toolMessage] = toolMessages(agent);
    expect(toolMessage?.content).toBe(`Error: ${result.error}`);
  });
});
