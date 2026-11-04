import type { ToolCall } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ToolCallStatus } from "../../types";
import { CopilotKitCore } from "../core";
import {
  ɵHITL_ABORTED_MESSAGE,
  ɵHumanInTheLoopRegistry,
  ɵbuildHumanInTheLoopTool,
  ɵhitlRenderProps,
} from "../human-in-the-loop";

const toolCall = (id: string, name = "approve"): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});

describe("ɵHumanInTheLoopRegistry", () => {
  it("parks a call until respond and reports whether it was waiting", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const result = registry.wait("call-1");
    expect(registry.isPending("call-1")).toBe(true);

    expect(registry.respond("call-1", { approved: true })).toBe(true);
    await expect(result).resolves.toEqual({ approved: true });
    expect(registry.isPending("call-1")).toBe(false);
    expect(registry.respond("call-1", "again")).toBe(false);
  });

  it("keeps parallel calls of one tool independent", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const handler = registry.createHandler();
    const first = handler({}, { toolCall: toolCall("a") });
    const second = handler({}, { toolCall: toolCall("b") });

    registry.respond("b", "second");
    registry.respond("a", "first");
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("rejects with the aborted message when the signal aborts", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const controller = new AbortController();
    const result = registry.wait("call", controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow(ɵHITL_ABORTED_MESSAGE);
    expect(registry.isPending("call")).toBe(false);
    expect(registry.respond("call", "late")).toBe(false);
  });

  it("rejects at once when the signal was already aborted", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const controller = new AbortController();
    controller.abort();
    await expect(registry.wait("call", controller.signal)).rejects.toThrow(
      ɵHITL_ABORTED_MESSAGE,
    );
    expect(registry.isPending("call")).toBe(false);
  });

  it("ignores the abort signal after the user responded", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const controller = new AbortController();
    const result = registry.wait("call", controller.signal);
    registry.respond("call", "yes");
    controller.abort();
    await expect(result).resolves.toBe("yes");
  });

  it("settles an earlier wait for the same call id when a new one replaces it", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const earlier = registry.wait("call");
    const later = registry.wait("call");
    await expect(earlier).rejects.toThrow(ɵHITL_ABORTED_MESSAGE);
    registry.respond("call", "yes");
    await expect(later).resolves.toBe("yes");
  });

  it("rejects every parked call on dispose", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const a = registry.wait("a");
    const b = registry.wait("b");
    registry.dispose();
    await expect(a).rejects.toThrow(ɵHITL_ABORTED_MESSAGE);
    await expect(b).rejects.toThrow(ɵHITL_ABORTED_MESSAGE);
  });

  it("is owned by the core and disposed with it", async () => {
    const core = new CopilotKitCore({});
    const registry = core.ɵhumanInTheLoop;
    expect(core.ɵhumanInTheLoop).toBe(registry);
    const parked = registry.wait("call");
    core.dispose();
    await expect(parked).rejects.toThrow(ɵHITL_ABORTED_MESSAGE);
  });
});

describe("ɵbuildHumanInTheLoopTool", () => {
  it("keeps the registration fields and parks calls in the registry", async () => {
    const registry = new ɵHumanInTheLoopRegistry();
    const tool = ɵbuildHumanInTheLoopTool(
      {
        name: "approve",
        description: "Ask the user",
        followUp: false,
        agentId: "agent",
        available: false,
      },
      registry,
    );
    expect(tool).toMatchObject({
      type: "human-in-the-loop",
      name: "approve",
      description: "Ask the user",
      followUp: false,
      agentId: "agent",
      available: false,
    });

    const result = tool.handler({}, { toolCall: toolCall("call") });
    registry.respond("call", "ok");
    await expect(result).resolves.toBe("ok");
  });
});

describe("ɵbuildHumanInTheLoopTool with a registry getter", () => {
  it("reads the registry when a call arrives", async () => {
    let registry: ɵHumanInTheLoopRegistry | undefined;
    const tool = ɵbuildHumanInTheLoopTool({ name: "approve" }, () => registry!);
    registry = new ɵHumanInTheLoopRegistry();

    const result = tool.handler({}, { toolCall: toolCall("call") });
    expect(registry.respond("call", "late core")).toBe(true);
    await expect(result).resolves.toBe("late core");
  });
});

describe("ɵhitlRenderProps", () => {
  const registry = new ɵHumanInTheLoopRegistry();
  const tool = { name: "approve", description: "Ask", agentId: "agent" };

  it("adds registration fields and a live respond while executing", async () => {
    const parked = registry.wait("call");
    const props = ɵhitlRenderProps(
      {
        name: "approve",
        toolCallId: "call",
        status: ToolCallStatus.Executing,
        args: { x: 1 },
        result: undefined,
      },
      tool,
      registry,
    );
    expect(props).toMatchObject({
      name: "approve",
      description: "Ask",
      agentId: "agent",
      toolCallId: "call",
      args: { x: 1 },
    });
    await props.respond?.("yes");
    await expect(parked).resolves.toBe("yes");
  });

  it.each([ToolCallStatus.InProgress, ToolCallStatus.Complete])(
    "has no respond while %s",
    (status) => {
      const props = ɵhitlRenderProps(
        {
          name: "approve",
          toolCallId: "call",
          status,
          args: {},
          result: status === ToolCallStatus.Complete ? "done" : undefined,
        },
        tool,
        registry,
      );
      expect(props.respond).toBeUndefined();
    },
  );

  it("keeps the called tool's name for a catch-all registration", () => {
    const props = ɵhitlRenderProps(
      {
        name: "deleteFile",
        toolCallId: "call",
        status: ToolCallStatus.InProgress,
        args: {},
        result: undefined,
      },
      { name: "*" },
      registry,
    );
    expect(props).toMatchObject({ name: "deleteFile", description: "" });
  });
});
