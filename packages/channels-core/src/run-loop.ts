import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
} from "./platform-adapter.js";
import type {
  ChannelTool,
  ChannelToolContext,
  AgentToolDescriptor,
  ContextEntry,
} from "./tools.js";
import { parseToolArgs, stringifyHandlerResult } from "./tools.js";

export interface RunLoopArgs {
  agent: AbstractAgent;
  renderer: RunRenderer;
  tools: Map<string, ChannelTool>;
  toolDescriptors: AgentToolDescriptor[];
  context: ContextEntry[];
  /** ctx passed to tool.handler (thread + platform). */
  makeToolCtx: (call: CapturedToolCall) => ChannelToolContext;
  /** Invoke the registered onInterrupt handler (posts a picker); the loop then ends. */
  handleInterrupt?: (interrupt: CapturedInterrupt) => Promise<void> | void;
  isAborted?: () => boolean;
  /** Hard cap on loop iterations. Default 6. */
  maxIterations?: number;
  /** When re-entering via thread.resume, the resume command to replay. */
  initialResume?: { resume: unknown };
  /** Subscriber used for each underlying agent step. Defaults to the renderer. */
  subscriber?: AgentSubscriber;
}

/**
 * Fan one agent event stream out to both the provider renderer and a canonical
 * runner subscriber. The proxy covers every current and future subscriber
 * callback without keeping a second callback-name registry in Channels.
 */
export function mergeAgentSubscribers(
  first: AgentSubscriber,
  second: AgentSubscriber,
): AgentSubscriber {
  return new Proxy({} as AgentSubscriber, {
    get(_target, property: keyof AgentSubscriber) {
      const firstCallback = first[property];
      const secondCallback = second[property];
      if (
        typeof firstCallback !== "function" &&
        typeof secondCallback !== "function"
      ) {
        return undefined;
      }

      return async (params: unknown) => {
        const firstResult =
          typeof firstCallback === "function"
            ? await (firstCallback as (value: unknown) => unknown)(params)
            : undefined;
        const secondResult =
          typeof secondCallback === "function"
            ? await (secondCallback as (value: unknown) => unknown)(params)
            : undefined;

        if (
          (firstResult === undefined || firstResult === null) &&
          (secondResult === undefined || secondResult === null)
        ) {
          return undefined;
        }
        return {
          ...(typeof firstResult === "object" ? firstResult : {}),
          ...(typeof secondResult === "object" ? secondResult : {}),
          stopPropagation:
            (typeof firstResult === "object" &&
              firstResult !== null &&
              "stopPropagation" in firstResult &&
              firstResult.stopPropagation === true) ||
            (typeof secondResult === "object" &&
              secondResult !== null &&
              "stopPropagation" in secondResult &&
              secondResult.stopPropagation === true),
        };
      };
    },
  });
}

/**
 * Drive the agent, executing frontend-tool calls and re-invoking until the
 * agent stops calling them (or we hit the iteration cap). On a captured
 * LangGraph-style interrupt the loop posts the picker via `handleInterrupt`
 * and returns immediately ("ack-first") — `thread.resume` re-enters later
 * with `initialResume` set.
 */
export async function runAgentLoop(
  args: RunLoopArgs,
): Promise<{ iterations: number; interrupted: boolean }> {
  const {
    agent,
    renderer,
    tools,
    toolDescriptors,
    context,
    makeToolCtx,
    handleInterrupt,
    isAborted,
    initialResume,
  } = args;
  const subscriber = args.subscriber
    ? mergeAgentSubscribers(renderer.subscriber, args.subscriber)
    : renderer.subscriber;
  const maxIterations = args.maxIterations ?? 6;
  const executed = new Set<string>();
  let resume = initialResume;

  for (let i = 0; i < maxIterations; i++) {
    if (resume) {
      await agent.runAgent({ forwardedProps: { command: resume } }, subscriber);
      resume = undefined;
    } else {
      await agent.runAgent(
        { tools: toolDescriptors as never, context: context as never },
        subscriber,
      );
    }
    if (isAborted?.()) return { iterations: i + 1, interrupted: false };

    const pending = renderer.getPendingInterrupt();
    if (pending) {
      renderer.clearPendingInterrupt();
      if (handleInterrupt) await handleInterrupt(pending);
      // ack-first: picker posted; thread.resume re-enters later
      return { iterations: i + 1, interrupted: true };
    }

    const calls = renderer
      .getCapturedToolCalls()
      .filter((c) => tools.has(c.toolCallName) && !executed.has(c.toolCallId));
    if (calls.length === 0) return { iterations: i + 1, interrupted: false };

    ensureAssistantToolCallMessage(agent, calls);
    for (const call of calls) {
      const tool = tools.get(call.toolCallName)!;
      let result: string;
      const parsed = await parseToolArgs(tool.parameters, call.toolCallArgs);
      if (!parsed.ok) {
        result = JSON.stringify({
          error: `invalid arguments: ${parsed.error}`,
        });
      } else {
        try {
          result = stringifyHandlerResult(
            await tool.handler(
              parsed.value as never,
              makeToolCtx(call) as never,
            ),
          );
        } catch (err) {
          result = JSON.stringify({ error: (err as Error).message });
        }
      }
      pushToolResult(agent, call.toolCallId, result);
      executed.add(call.toolCallId);
    }
  }
  return { iterations: maxIterations, interrupted: false };
}

/**
 * If the agent's latest message isn't already the assistant message that
 * issued these tool calls, append one. AG-UI's agent middleware *should*
 * populate this from the streamed events, but we defensively reconcile here
 * so the next `runAgent` sees a valid transcript even on backends that don't.
 */
export function ensureAssistantToolCallMessage(
  agent: AbstractAgent,
  calls: ReadonlyArray<CapturedToolCall>,
): void {
  const messages = agent.messages;
  const last = messages[messages.length - 1];
  const lastIsAssistantWithCalls =
    last !== undefined &&
    last.role === "assistant" &&
    Array.isArray(last.toolCalls);

  if (lastIsAssistantWithCalls) {
    const existing = (last.toolCalls ?? []).map((tc) => tc.id);
    const allPresent = calls.every((c) => existing.includes(c.toolCallId));
    if (allPresent) return;
  }

  const assistant: Message = {
    id: `${calls[0]!.toolCallId}-assistant`,
    role: "assistant",
    content: "",
    toolCalls: calls.map((c) => ({
      id: c.toolCallId,
      type: "function" as const,
      function: {
        name: c.toolCallName,
        arguments: JSON.stringify(c.toolCallArgs),
      },
    })),
  };
  agent.addMessage(assistant);
}

export function pushToolResult(
  agent: AbstractAgent,
  toolCallId: string,
  content: string,
): void {
  const toolMessage: Message = {
    id: `${toolCallId}-result`,
    role: "tool",
    toolCallId,
    content,
  };
  agent.addMessage(toolMessage);
}
