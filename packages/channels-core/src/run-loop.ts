import { EventType } from "@ag-ui/client";
import type {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
  RunErrorEvent,
} from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import type {
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
  CanonicalRunIdentity,
  ChannelAgentLoopResult,
} from "./platform-adapter.js";
import type {
  ChannelTool,
  ChannelToolContext,
  AgentToolDescriptor,
  ContextEntry,
} from "./tools.js";
import { parseToolArgs, stringifyHandlerResult } from "./tools.js";
import type { ChannelActorIdentity } from "./identity.js";
import {
  channelDeliveryErrorDetails,
  isChannelDeliveryTerminatedError,
} from "./delivery-error.js";

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
  /**
   * When re-entering via thread.resume, the resume command to replay. Sent
   * verbatim as `forwardedProps.command`, so any field here reaches the agent.
   * `interruptEvent` echoes the originating interrupt back for bridges that key
   * their resume off it (@ag-ui/mastra); it is absent unless one was captured.
   */
  initialResume?: { resume: unknown; interruptEvent?: unknown };
  /** Subscriber used for each underlying agent step. Defaults to the renderer. */
  subscriber?: AgentSubscriber;
  /**
   * Canonical identity for a managed outer run. When set, inner agent lifecycle
   * events stay private to each tool-loop step and this function emits one
   * lifecycle around the whole loop.
   */
  canonicalRun?: CanonicalRunIdentity;
  /**
   * Who is speaking this turn. Forwarded to the agent as
   * `forwardedProps.channelActor` on every run this loop performs, including a
   * resume — a resume's actor is whoever pressed the button, which is not
   * always whoever started the turn.
   *
   * Supplied by the Thread from the ingress event, never by a caller passing a
   * value of its own: an agent that acts as this person has to be reading the
   * platform's word for who spoke.
   */
  identity?: ChannelActorIdentity;
}

/**
 * The identity half of `forwardedProps`, as a spreadable object.
 *
 * Empty when the turn named nobody, so the run carries no `channelActor` key at
 * all rather than one holding `undefined`. An agent then gets the same answer
 * from a missing key and an anonymous turn, instead of two shapes meaning one
 * thing.
 */
function forwardedIdentity(
  identity: ChannelActorIdentity | undefined,
): Record<string, unknown> {
  return identity ? { channelActor: identity } : {};
}

interface SubscriberFanoutOptions {
  canonicalRun?: CanonicalRunIdentity;
  onInnerRunError?: (event: RunErrorEvent) => void;
  onRendererError?: (error: unknown) => void;
  /** Stops provider callbacks after their first terminal delivery error. */
  isRendererClosed?: () => boolean;
}

type SubscriberCallback = (value: unknown) => unknown;

/**
 * Merge two subscriber callback results while preserving either subscriber's
 * request to stop propagation.
 */
function mergeSubscriberResults(
  firstResult: unknown,
  secondResult: unknown,
): unknown {
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
}

/**
 * Invoke canonical ingestion before rendering, but always invoke both. A
 * renderer failure therefore cannot prevent the same event from reaching the
 * runner.
 */
async function invokeSubscriberPair(
  rendererCallback: SubscriberCallback | undefined,
  ingestionCallback: SubscriberCallback | undefined,
  params: unknown,
  onRendererError?: (error: unknown) => void,
  isRendererClosed?: () => boolean,
): Promise<unknown> {
  let rendererResult: unknown;
  let ingestionResult: unknown;
  let rendererError: unknown;
  let ingestionError: unknown;
  let rendererFailed = false;
  let ingestionFailed = false;

  try {
    ingestionResult = await ingestionCallback?.(params);
  } catch (error) {
    ingestionFailed = true;
    ingestionError = error;
  }
  if (!isRendererClosed?.()) {
    try {
      rendererResult = await rendererCallback?.(params);
    } catch (error) {
      rendererFailed = true;
      rendererError = error;
    }
  }

  if (ingestionFailed) throw ingestionError;
  if (rendererFailed) {
    if (!onRendererError) throw rendererError;
    onRendererError(rendererError);
  }
  return mergeSubscriberResults(rendererResult, ingestionResult);
}

/**
 * Return one stamped event object for every callback generated from the same
 * raw AG-UI event.
 */
function canonicalizeSubscriberParams(
  params: unknown,
  options: SubscriberFanoutOptions,
  stampedEvents: WeakMap<BaseEvent, BaseEvent>,
): unknown | undefined {
  if (
    typeof params !== "object" ||
    params === null ||
    !("event" in params) ||
    typeof params.event !== "object" ||
    params.event === null ||
    !("type" in params.event)
  ) {
    return params;
  }

  const event = params.event as BaseEvent;
  if (
    options.canonicalRun &&
    (event.type === EventType.RUN_STARTED ||
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR)
  ) {
    if (event.type === EventType.RUN_ERROR) {
      options.onInnerRunError?.(event as RunErrorEvent);
    }
    return undefined;
  }

  if (!options.canonicalRun) return params;
  let stamped = stampedEvents.get(event);
  if (!stamped) {
    stamped = {
      ...event,
      threadId: options.canonicalRun.threadId,
      runId: options.canonicalRun.runId,
    } as BaseEvent;
    stampedEvents.set(event, stamped);
  }
  return { ...params, event: stamped };
}

/**
 * Fan one agent event stream out to both the provider renderer and a canonical
 * runner subscriber. The proxy covers every current and future subscriber
 * callback without keeping a second callback-name registry in Channels.
 */
export function mergeAgentSubscribers(
  first: AgentSubscriber,
  second: AgentSubscriber,
  options: SubscriberFanoutOptions = {},
): AgentSubscriber {
  const stampedEvents = new WeakMap<BaseEvent, BaseEvent>();
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
        const canonicalParams = canonicalizeSubscriberParams(
          params,
          options,
          stampedEvents,
        );
        if (canonicalParams === undefined) return undefined;
        return invokeSubscriberPair(
          typeof firstCallback === "function"
            ? (firstCallback as SubscriberCallback)
            : undefined,
          typeof secondCallback === "function"
            ? (secondCallback as SubscriberCallback)
            : undefined,
          canonicalParams,
          options.onRendererError,
          options.isRendererClosed,
        );
      };
    },
  });
}

/** Convert an inner AG-UI error event into the error rejected by the outer run. */
function errorFromInnerRun(event: RunErrorEvent): Error & { code?: string } {
  const error: Error & { code?: string } = new Error(event.message);
  error.name = "ChannelInnerRunError";
  if (event.code) error.code = event.code;
  return error;
}

/**
 * Emit one canonical lifecycle event through the same ingestion-first fanout
 * used by streamed events.
 */
async function emitCanonicalLifecycleEvent(
  event: BaseEvent,
  result: { iterations: number; interrupted: boolean } | undefined,
  args: RunLoopArgs,
  onRendererError: (error: unknown) => void,
  isRendererClosed: () => boolean,
): Promise<void> {
  const canonicalRun = args.canonicalRun;
  if (!canonicalRun) return;
  const input: RunAgentInput = {
    threadId: canonicalRun.threadId,
    runId: canonicalRun.runId,
    messages: args.agent.messages,
    state: args.agent.state,
    tools: [...args.toolDescriptors],
    context: [...args.context],
    // Mirrors what the loop actually sends, so a subscriber reading `input`
    // sees the same turn the agent saw.
    forwardedProps: forwardedIdentity(args.identity),
  };
  const baseParams = {
    messages: args.agent.messages,
    state: args.agent.state,
    agent: args.agent,
    input,
  };
  const ingestion = args.subscriber ?? {};
  const renderer = args.renderer.subscriber;
  const eventParams = { ...baseParams, event };

  await invokeSubscriberPair(
    renderer.onEvent as SubscriberCallback | undefined,
    ingestion.onEvent as SubscriberCallback | undefined,
    eventParams,
    onRendererError,
    isRendererClosed,
  );

  if (event.type === EventType.RUN_STARTED) {
    await invokeSubscriberPair(
      renderer.onRunStartedEvent as SubscriberCallback | undefined,
      ingestion.onRunStartedEvent as SubscriberCallback | undefined,
      eventParams,
      onRendererError,
      isRendererClosed,
    );
  } else if (event.type === EventType.RUN_FINISHED) {
    await invokeSubscriberPair(
      renderer.onRunFinishedEvent as SubscriberCallback | undefined,
      ingestion.onRunFinishedEvent as SubscriberCallback | undefined,
      {
        ...baseParams,
        event,
        outcome: "success",
        result,
      },
      onRendererError,
      isRendererClosed,
    );
  } else if (event.type === EventType.RUN_ERROR) {
    await invokeSubscriberPair(
      renderer.onRunErrorEvent as SubscriberCallback | undefined,
      ingestion.onRunErrorEvent as SubscriberCallback | undefined,
      eventParams,
      onRendererError,
      isRendererClosed,
    );
  }
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
): Promise<ChannelAgentLoopResult> {
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
  let innerRunError: Error | undefined;
  let hasDeliveryError = false;
  let deliveryError: unknown;
  const deferRendererError = (error: unknown): void => {
    if (hasDeliveryError) return;
    hasDeliveryError = true;
    deliveryError = error;
  };
  const isRendererClosed = (): boolean => hasDeliveryError;
  const subscriber =
    args.subscriber || args.canonicalRun
      ? mergeAgentSubscribers(
          renderer.subscriber,
          args.subscriber ?? {},
          args.canonicalRun
            ? {
                canonicalRun: args.canonicalRun,
                onInnerRunError: (event) => {
                  innerRunError ??= errorFromInnerRun(event);
                },
                onRendererError: deferRendererError,
                isRendererClosed,
              }
            : {},
        )
      : renderer.subscriber;
  const maxIterations = args.maxIterations ?? 6;
  const executed = new Set<string>();
  let resume = initialResume;

  const executeIterations = async (): Promise<{
    iterations: number;
    interrupted: boolean;
  }> => {
    for (let i = 0; i < maxIterations; i++) {
      if (resume) {
        await agent.runAgent(
          {
            forwardedProps: {
              ...forwardedIdentity(args.identity),
              command: resume,
            },
          },
          subscriber,
        );
        resume = undefined;
      } else {
        await agent.runAgent(
          {
            tools: toolDescriptors as never,
            context: context as never,
            forwardedProps: forwardedIdentity(args.identity),
          },
          subscriber,
        );
      }
      if (innerRunError) throw innerRunError;
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
        .filter(
          (c) => tools.has(c.toolCallName) && !executed.has(c.toolCallId),
        );
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
          await args.canonicalRun?.beforeToolCall?.();
          try {
            result = stringifyHandlerResult(
              await tool.handler(
                parsed.value as never,
                makeToolCtx(call) as never,
              ),
            );
          } catch (err) {
            if (isChannelDeliveryTerminatedError(err)) {
              // The provider already terminalled this delivery. Freeze renderer
              // fanout before the canonical RUN_ERROR is ingested, then stop the
              // loop instead of inviting the model to emit through a closed path.
              deferRendererError(err);
              throw err;
            }
            result = JSON.stringify({ error: (err as Error).message });
          }
        }
        pushToolResult(agent, call.toolCallId, result);
        executed.add(call.toolCallId);
      }
    }
    return { iterations: maxIterations, interrupted: false };
  };

  if (!args.canonicalRun) {
    return executeIterations();
  }

  const startEvent: BaseEvent = {
    type: EventType.RUN_STARTED,
    threadId: args.canonicalRun.threadId,
    runId: args.canonicalRun.runId,
  };
  try {
    await emitCanonicalLifecycleEvent(
      startEvent,
      undefined,
      args,
      deferRendererError,
      isRendererClosed,
    );
    const result = await executeIterations();
    const finishedEvent: BaseEvent = {
      type: EventType.RUN_FINISHED,
      threadId: args.canonicalRun.threadId,
      runId: args.canonicalRun.runId,
    };
    await emitCanonicalLifecycleEvent(
      finishedEvent,
      result,
      args,
      deferRendererError,
      isRendererClosed,
    );
    return hasDeliveryError ? { ...result, deliveryError } : result;
  } catch (error) {
    const details = channelDeliveryErrorDetails(error);
    const runError: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      threadId: args.canonicalRun.threadId,
      runId: args.canonicalRun.runId,
      message: error instanceof Error ? error.message : String(error),
      ...(typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? { code: error.code }
        : {}),
      ...(details
        ? {
            category: details.category,
            provider: details.provider,
            operation: details.operation,
            effectKind: details.effectKind,
            providerCode: details.providerCode,
            validationMessages: details.validationMessages,
            retryable: details.retryable,
            deliveryId: details.deliveryId,
            details,
            cause: details,
          }
        : {}),
    } as RunErrorEvent;
    try {
      await emitCanonicalLifecycleEvent(
        runError,
        undefined,
        args,
        deferRendererError,
        isRendererClosed,
      );
    } catch {
      // Preserve the original run failure after canonical ingestion got its
      // chance to record the terminal error.
    }
    throw error;
  }
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
