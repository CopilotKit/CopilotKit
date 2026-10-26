import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { from } from "rxjs";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";
import { FORWARDED_TO_CLIENT } from "../core/tool-result-content";
import type { FrontendTool } from "../types";
import { createTool, createToolCallMessage } from "./test-utils";

type ScriptedCall = {
  name: string;
  /** Emit a TOOL_CALL_RESULT for the call, as a backend tool does. */
  result?: string;
};

type ScriptedRun = {
  calls?: ScriptedCall[];
  /**
   * How the run ends: RUN_FINISHED with a `success`, `interrupt` or
   * `cancelled` outcome, the legacy `on_interrupt` custom event, or RUN_ERROR.
   */
  end?: "success" | "interrupt" | "legacy-interrupt" | "cancelled" | "error";
  /** Follow the run with a second, clean run in the same stream. */
  thenCleanRun?: boolean;
};

/**
 * Plays one scripted run per `runAgent` call. A run with no script left
 * replies with plain text. `onRun` fires once the run input (with its
 * advertised tools) has been built, before any event is emitted.
 */
class ScriptedAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  onRun?: () => void;

  constructor(private readonly script: ScriptedRun[] = []) {
    super({ agentId: "default", threadId: "thread-one" });
  }

  run(input: RunAgentInput) {
    this.inputs.push(input);
    this.onRun?.();
    const runIndex = this.inputs.length - 1;
    const step = this.script[runIndex] ?? {};
    const messageId = `assistant-${runIndex}`;
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    ];
    if (!step.calls) {
      events.push({
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId,
        role: "assistant",
        delta: "done",
      } as BaseEvent);
    }
    (step.calls ?? []).forEach((call, callIndex) => {
      const toolCallId = `call-${runIndex}-${callIndex}`;
      events.push(
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: call.name,
          parentMessageId: messageId,
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: "{}",
        } as BaseEvent,
        { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent,
      );
      if (call.result !== undefined) {
        events.push({
          type: EventType.TOOL_CALL_RESULT,
          messageId: `result-${toolCallId}`,
          toolCallId,
          content: call.result,
        } as BaseEvent);
      }
    });
    if (step.end === "error") {
      events.push({ type: EventType.RUN_ERROR, message: "boom" } as BaseEvent);
      return from(events);
    }
    if (step.end === "legacy-interrupt") {
      events.push({
        type: EventType.CUSTOM,
        name: "on_interrupt",
        value: "approve?",
      } as BaseEvent);
    }
    const outcome =
      step.end === "interrupt"
        ? {
            type: "interrupt",
            interrupts: [
              {
                id: "interrupt-one",
                reason: "tool_call",
                toolCallId: `call-${runIndex}-0`,
              },
            ],
          }
        : step.end === "cancelled"
          ? { type: "cancelled" }
          : step.end === "success"
            ? { type: "success" }
            : undefined;
    events.push({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      ...(outcome ? { outcome } : {}),
    } as BaseEvent);
    if (step.thenCleanRun) {
      const runId = `${input.runId}-next`;
      events.push(
        {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId,
        } as BaseEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId,
        } as BaseEvent,
      );
    }
    return from(events);
  }

  /** Reconnecting replays `replay` as the thread's history. */
  replay: Message[] = [];

  protected connect(input: RunAgentInput) {
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
      { type: EventType.MESSAGES_SNAPSHOT, messages: this.replay } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    ]);
  }
}

/**
 * Registers `update_surface`, so the run advertises it, then unregisters it
 * once the run has started, as when the component that registered the tool
 * unmounts mid-run.
 */
function setup(
  script: ScriptedRun[],
  tool: Partial<FrontendTool<Record<string, unknown>>> = {},
) {
  const core = new CopilotKitCore({});
  const agent = new ScriptedAgent(script);
  core.addAgent__unsafe_dev_only({ id: "default", agent });
  core.addTool(createTool({ ...tool, name: "update_surface" }));
  agent.onRun = () => {
    core.removeTool("update_surface");
    agent.onRun = undefined;
  };
  const onError = vi.fn();
  core.subscribe({ onError });
  return { core, agent, onError };
}

function toolMessages(messages: Message[]) {
  return messages.filter((message) => message.role === "tool");
}

function advertisedNames(input: RunAgentInput) {
  return input.tools.map((tool) => tool.name);
}

describe("tool calls to an advertised tool that is no longer registered", () => {
  it.each([undefined, "success"] as const)(
    "answers the call with an error and reports TOOL_NOT_FOUND (outcome: %s)",
    async (end) => {
      const { core, agent, onError } = setup([
        { calls: [{ name: "update_surface" }], end },
      ]);

      await core.runAgent({ agent });

      expect(advertisedNames(agent.inputs[0]!)).toContain("update_surface");
      expect(toolMessages(agent.messages)).toEqual([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-0-0",
          content: "Error: Tool not found: update_surface",
          error: "Tool not found: update_surface",
        }),
      ]);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
          context: expect.objectContaining({
            agentId: "default",
            toolCallId: "call-0-0",
            toolName: "update_surface",
          }),
        }),
      );
    },
  );

  it("answers a removed human-in-the-loop tool's call", async () => {
    const { core, agent, onError } = setup(
      [{ calls: [{ name: "update_surface" }] }],
      { type: "human-in-the-loop" },
    );

    await core.runAgent({ agent });

    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "Error: Tool not found: update_surface",
      }),
    ]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
      }),
    );
  });

  it("starts no follow-up run, and the next run sends the completed pair", async () => {
    const { core, agent } = setup([{ calls: [{ name: "update_surface" }] }]);

    await core.runAgent({ agent });
    expect(agent.inputs).toHaveLength(1);

    await core.runAgent({ agent });
    expect(agent.inputs).toHaveLength(2);
    expect(toolMessages(agent.inputs[1]!.messages)).toEqual([
      expect.objectContaining({ toolCallId: "call-0-0" }),
    ]);
  });

  it("leaves a call to a name the run never advertised untouched", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "update_surface_item" }] },
    ]);

    await core.runAgent({ agent });

    expect(advertisedNames(agent.inputs[0]!)).not.toContain(
      "update_surface_item",
    );
    expect(toolMessages(agent.messages)).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("leaves a call that already has a result in the run untouched", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "update_surface", result: "saved" }] },
    ]);

    await core.runAgent({ agent });

    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({ toolCallId: "call-0-0", content: "saved" }),
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("lets a registered wildcard tool handle the call instead", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "update_surface" }] },
    ]);
    const handler = vi.fn(async () => "handled by wildcard");
    core.addTool(createTool({ name: "*", handler, followUp: false }));

    await core.runAgent({ agent });

    expect(handler).toHaveBeenCalledOnce();
    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "handled by wildcard",
      }),
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["interrupt", "legacy-interrupt", "cancelled", "error"] as const)(
    "leaves the open call of a run that ends with %s untouched",
    async (end) => {
      const { core, agent, onError } = setup([
        { calls: [{ name: "update_surface" }], end },
      ]);

      await core.runAgent({ agent });

      expect(toolMessages(agent.messages)).toEqual([]);
      expect(onError).not.toHaveBeenCalledWith(
        expect.objectContaining({
          code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
        }),
      );
      expect(agent.inputs).toHaveLength(1);
      if (end === "error") {
        // The failure itself is still reported; only the open call is left.
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            code: CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT,
          }),
        );
      }
    },
  );
});

describe("runs and reconnects that leave calls open", () => {
  it.each(["interrupt", "legacy-interrupt", "cancelled"] as const)(
    "keeps the call open when a run that ends with %s is followed by a clean run in the same stream",
    async (end) => {
      const { core, agent, onError } = setup([
        { calls: [{ name: "update_surface" }], end, thenCleanRun: true },
      ]);

      await core.runAgent({ agent });

      expect(toolMessages(agent.messages)).toEqual([]);
      expect(onError).not.toHaveBeenCalledWith(
        expect.objectContaining({
          code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
        }),
      );
    },
  );

  it("leaves a restored call to a tool that is no longer registered untouched", async () => {
    const { core, agent, onError } = setup([]);
    core.removeTool("update_surface");
    agent.replay = [createToolCallMessage("update_surface")];

    await core.connectAgent({ agent });

    expect(agent.messages).toHaveLength(1);
    expect(toolMessages(agent.messages)).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("a forwarded-to-client placeholder for an advertised tool", () => {
  it("replaces a forwarded-to-client placeholder with the error", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "update_surface", result: FORWARDED_TO_CLIENT }] },
    ]);

    await core.runAgent({ agent });

    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "Error: Tool not found: update_surface",
      }),
    ]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
      }),
    );
  });

  it("keeps a real answer in the run result over a live placeholder", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "update_surface", result: FORWARDED_TO_CLIENT }] },
    ]);
    const runAgent = agent.runAgent.bind(agent);
    agent.runAgent = async (...args) => {
      const result = await runAgent(...args);
      return {
        ...result,
        newMessages: result.newMessages.map((message) =>
          message.role === "tool"
            ? { ...message, content: "real answer" }
            : message,
        ),
      };
    };

    const result = await core.runAgent({ agent });

    expect(toolMessages(result.newMessages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "real answer",
      }),
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("sends the error, not the placeholder, on the next run", async () => {
    const { core, agent } = setup([
      { calls: [{ name: "update_surface", result: FORWARDED_TO_CLIENT }] },
    ]);

    await core.runAgent({ agent });
    await core.runAgent({ agent });

    expect(agent.inputs).toHaveLength(2);
    expect(toolMessages(agent.inputs[1]!.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "Error: Tool not found: update_surface",
      }),
    ]);
  });

  it("keeps the placeholder of a registered tool with no handler", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "render_only", result: FORWARDED_TO_CLIENT }] },
    ]);
    core.addTool(createTool({ name: "render_only", handler: undefined }));

    await core.runAgent({ agent });

    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: FORWARDED_TO_CLIENT,
      }),
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("lets a registered wildcard tool replace the placeholder", async () => {
    const { core, agent, onError } = setup([
      { calls: [{ name: "update_surface", result: FORWARDED_TO_CLIENT }] },
    ]);
    const handler = vi.fn(async () => "handled by wildcard");
    core.addTool(createTool({ name: "*", handler, followUp: false }));

    await core.runAgent({ agent });

    expect(handler).toHaveBeenCalledOnce();
    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "handled by wildcard",
      }),
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("answers only the removed tool's call when a run calls two tools", async () => {
    const { core, agent, onError } = setup([
      {
        calls: [
          { name: "update_surface", result: FORWARDED_TO_CLIENT },
          { name: "render_only", result: FORWARDED_TO_CLIENT },
        ],
      },
    ]);
    core.addTool(createTool({ name: "render_only", handler: undefined }));

    await core.runAgent({ agent });

    expect(toolMessages(agent.messages)).toEqual([
      expect.objectContaining({
        toolCallId: "call-0-0",
        content: "Error: Tool not found: update_surface",
      }),
      expect.objectContaining({
        toolCallId: "call-0-1",
        content: FORWARDED_TO_CLIENT,
      }),
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it.each(["interrupt", "legacy-interrupt", "cancelled", "error"] as const)(
    "keeps the placeholder of a run that ends with %s",
    async (end) => {
      const { core, agent, onError } = setup([
        {
          calls: [{ name: "update_surface", result: FORWARDED_TO_CLIENT }],
          end,
        },
      ]);

      await core.runAgent({ agent });

      expect(toolMessages(agent.messages)).toEqual([
        expect.objectContaining({
          toolCallId: "call-0-0",
          content: FORWARDED_TO_CLIENT,
        }),
      ]);
      expect(onError).not.toHaveBeenCalledWith(
        expect.objectContaining({
          code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
        }),
      );
    },
  );
});
