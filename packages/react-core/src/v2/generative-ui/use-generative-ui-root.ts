import { useEffect, useMemo, useRef } from "react";
import type { AbstractAgent, Message } from "@ag-ui/client";
import {
  A2UI_VERSION,
  COPILOTKIT_FORWARDED_PROPS_KEY,
  DEFAULT_AGENT_ID,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  GENERATIVE_UI_MARKDOWN_GUIDELINES,
  randomUUID,
  validateOperation,
} from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
  ValidateOperationOptions,
} from "@copilotkit/shared";
import type { CopilotKitCoreReact } from "../lib/react-core";
import { useShallowStableRef } from "../lib/shallow-stable-ref";
import {
  buildActionMessageText,
  createComponentLabelResolver,
} from "./action-message";
import { createGenerativeUIDispatcher } from "./dispatcher";
import type { GenerativeUIDispatcher } from "./dispatcher";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIErrorCode, GenerativeUIErrorInfo } from "./errors";
import { buildGenerativeUIEnvelope } from "./manifest";
import type { GenerativeUIEnvelopeOptions } from "./manifest";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "./runtime-context";
import { useGenerativeUIMarkdownContext } from "./markdown/context";
import { getMarkdownSurfaceSource } from "./markdown/source";
import type { MarkdownFunctionCall } from "./markdown/source";
import { GenerativeUISurfaceManager } from "./surface-manager";
import type { ManagedSurface } from "./surface-manager";

const isDevelopment = () => process.env.NODE_ENV !== "production";

/** At most this many function follow-up runs for each user turn. */
const MAX_FUNCTION_FOLLOW_UPS = 5;

type ReadonlyMessages = ReadonlyArray<Readonly<Message>>;

function ingestMessages(
  manager: GenerativeUISurfaceManager,
  agent: AbstractAgent,
  messages: ReadonlyMessages,
) {
  if (!agent.threadId) return;
  for (const message of messages) {
    if (
      message.role === "activity" &&
      message.activityType === GENERATIVE_UI_ACTIVITY_TYPE
    ) {
      manager.ingest(
        agent.threadId,
        agent.agentId,
        message.content as unknown as GenerativeUISurfaceContent,
      );
    }
  }
}

/** What the envelope of a run says, from the provider config. */
function envelopeOptionsFor(
  config: GenerativeUIConfig,
): GenerativeUIEnvelopeOptions {
  if (config.transport === "markdown") {
    return {
      transport: "markdown",
      includeCatalog: config.includeCatalog !== false,
      contextSent: config.sendContext !== false,
      instructions: GENERATIVE_UI_MARKDOWN_GUIDELINES,
    };
  }
  return { transport: "tool", includeCatalog: true, contextSent: false };
}

/**
 * The components of a surface as one `updateComponents` operation, so that
 * the label of the component that sent an event can be found.
 */
function surfaceComponents(surface: ManagedSurface): A2UIOperation[] {
  const entries = [...surface.model.componentsModel.entries];
  const components = entries.map(([id, model]) => ({
    ...model.properties,
    id,
    component: model.type,
  }));
  return [
    {
      version: A2UI_VERSION,
      updateComponents: { surfaceId: surface.surfaceId, components },
    },
  ];
}

/** One agent-called function, as the model sent it. */
interface FunctionCallRequest {
  functionCallId: string;
  /** A `callRendererFunction` operation. It is not validated yet. */
  operation: unknown;
}

/** The answer to one function call, before it goes to the agent. */
interface FunctionCallAnswer {
  /** The text of the developer message: a `rendererFunctionResponse`. */
  content: string;
  /** `false` for a call over the cap. It starts no follow-up run. */
  followUp: boolean;
}

/** What the root keeps for the function calls of one thread. */
interface ThreadFunctionCalls {
  /** The calls that ran, or that have an answer. They do not run again. */
  done: Set<string>;
  /** The answers that are not in the messages yet, in call order. */
  pending: Promise<FunctionCallAnswer>[];
  /** The id of the last user message: the user turn of `followUps`. */
  turn: string | undefined;
  /** The function follow-up runs of this user turn. */
  followUps: number;
  /** A flush adds answers or waits for its follow-up run. */
  flushing: boolean;
}

/** True when `value` names a `functionCallId`. */
function hasFunctionCallId(
  value: unknown,
): value is { functionCallId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "functionCallId" in value &&
    typeof value.functionCallId === "string" &&
    value.functionCallId !== ""
  );
}

/** The `functionCallId` that a developer message answers, if any. */
function answeredCallId(content: string) {
  if (!content.includes("rendererFunctionResponse")) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    const response =
      typeof parsed === "object" &&
      parsed !== null &&
      "rendererFunctionResponse" in parsed
        ? parsed.rendererFunctionResponse
        : undefined;
    return hasFunctionCallId(response) ? response.functionCallId : undefined;
  } catch {
    return undefined;
  }
}

/** The function calls that a developer message in `messages` answers. */
function answeredCallIds(messages: ReadonlyMessages) {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "developer") continue;
    const id = answeredCallId(message.content);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/** The id of the last user message. A user turn starts with it. */
function lastUserMessageId(messages: ReadonlyMessages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user") return message.id;
  }
  return undefined;
}

/** The function calls of the tool transport: its function-call activities. */
function activityFunctionCalls(messages: ReadonlyMessages) {
  const requests: FunctionCallRequest[] = [];
  for (const message of messages) {
    const isFunctionCall =
      message.role === "activity" &&
      message.activityType === GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE;
    if (!isFunctionCall || !hasFunctionCallId(message.content)) continue;
    requests.push({
      functionCallId: message.content.functionCallId,
      operation: {
        version: A2UI_VERSION,
        callRendererFunction: message.content,
      },
    });
  }
  return requests;
}

/** The function calls of the markdown transport: its fence lines. */
function markdownFunctionCalls(calls: MarkdownFunctionCall[]) {
  const requests: FunctionCallRequest[] = [];
  for (const { operation } of calls) {
    const payload = operation.callRendererFunction;
    // With no functionCallId, there is nothing to answer.
    if (!hasFunctionCallId(payload)) continue;
    requests.push({ functionCallId: payload.functionCallId, operation });
  }
  return requests;
}

/** The text of a `rendererFunctionResponse` developer message. */
function responseContent(
  response:
    | { functionCallId: string; value: unknown }
    | {
        functionCallId: string;
        error: {
          code: GenerativeUIErrorCode | "follow_up_limit";
          message: string;
        };
      },
) {
  return JSON.stringify({
    version: A2UI_VERSION,
    rendererFunctionResponse: response,
  });
}

function errorAnswer(
  functionCallId: string,
  code: GenerativeUIErrorCode,
  message: string,
): FunctionCallAnswer {
  return {
    content: responseContent({ functionCallId, error: { code, message } }),
    followUp: true,
  };
}

const overCapAnswer = (functionCallId: string): FunctionCallAnswer => ({
  content: responseContent({
    functionCallId,
    error: {
      code: "follow_up_limit",
      message: `The function did not run. A user turn can have at most ${MAX_FUNCTION_FOLLOW_UPS} function follow-up runs. Wait for the next user message.`,
    },
  }),
  followUp: false,
});

/**
 * Runs the functions that the agent calls with `callRendererFunction`, for
 * both transports, and answers each call.
 *
 * - Each `functionCallId` runs once for each thread. A replay, a sync of
 *   the same messages again, or a call that already has an answer message
 *   does not run it again.
 * - The answer is a hidden developer message with a `rendererFunctionResponse`.
 *   The answers go to the agent only when it is not running. Then one
 *   follow-up run starts for all of them.
 * - A user turn has at most {@link MAX_FUNCTION_FOLLOW_UPS} follow-up runs.
 *   A call after that does not run. It gets a `follow_up_limit` error and
 *   starts no follow-up run.
 */
function createFunctionCallRunner(options: {
  copilotkit: CopilotKitCoreReact;
  dispatcher: GenerativeUIDispatcher;
  manifest: ValidateOperationOptions["manifest"];
}) {
  const { copilotkit, dispatcher, manifest } = options;
  const threads = new Map<string, ThreadFunctionCalls>();

  const threadState = (threadId: string) => {
    let state = threads.get(threadId);
    if (!state) {
      state = {
        done: new Set(),
        pending: [],
        turn: undefined,
        followUps: 0,
        flushing: false,
      };
      threads.set(threadId, state);
    }
    return state;
  };

  const answer = async (
    request: FunctionCallRequest,
  ): Promise<FunctionCallAnswer> => {
    const { functionCallId } = request;
    const validation = validateOperation(request.operation, {
      manifest,
      knownSurfaces: new Set(),
    });
    if (!validation.ok) {
      return errorAnswer(
        functionCallId,
        "invalid_arguments",
        validation.reason,
      );
    }
    // validateOperation checked the shape of the operation.
    const operation = request.operation as A2UIOperation;
    if (!("callRendererFunction" in operation)) {
      return errorAnswer(
        functionCallId,
        "invalid_arguments",
        "the operation is not a callRendererFunction",
      );
    }
    const { callFunction } = operation.callRendererFunction;
    const name = callFunction["@call"];
    const result = await dispatcher.invoke(name, callFunction.args ?? {}, {
      functionCallId,
    });
    if (!result.ok) {
      return errorAnswer(
        functionCallId,
        result.error.code,
        result.error.message,
      );
    }
    try {
      // A handler that returns nothing answers with null: JSON has no undefined.
      const value = result.result ?? null;
      return {
        content: responseContent({ functionCallId, value }),
        followUp: true,
      };
    } catch (cause) {
      return errorAnswer(
        functionCallId,
        "handler_failed",
        `The result of "${name}" is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  /**
   * Adds the pending answers of a thread to the agent, then starts one
   * follow-up run. It waits while the agent runs: the next read of the
   * thread, at the end of the run, flushes again.
   */
  const flush = async (
    agent: AbstractAgent,
    threadId: string,
    state: ThreadFunctionCalls,
  ) => {
    if (state.flushing) return;
    state.flushing = true;
    try {
      while (state.pending.length > 0) {
        const batch = [...state.pending];
        const answers = await Promise.all(batch);
        // As for a frontend-tool follow-up: let React commit the state that
        // the handlers set, so that the follow-up run reads it.
        await copilotkit.waitForPendingFrameworkUpdates();
        const isElsewhere = agent.isRunning || agent.threadId !== threadId;
        if (isElsewhere) return;
        // More calls came while these ran. They are one batch with them.
        if (state.pending.length > batch.length) continue;
        state.pending = [];
        for (const { content } of answers) {
          agent.addMessage({ id: randomUUID(), role: "developer", content });
        }
        if (!answers.some((item) => item.followUp)) continue;
        state.followUps++;
        await copilotkit.runAgent({ agent });
      }
    } catch (error) {
      if (isDevelopment()) {
        console.warn("[generativeUI] function follow-up run failed:", error);
      }
    } finally {
      state.flushing = false;
    }
  };

  return {
    /**
     * Runs the calls of the thread of `agent` that did not run yet. When no
     * run goes on, it also sends the pending answers.
     *
     * @param agent - The agent of the thread.
     * @param requests - The function calls in the messages, in order.
     * @param messages - All messages of the thread.
     * @param running - A run goes on or starts now. The answers wait.
     */
    run(
      agent: AbstractAgent,
      requests: FunctionCallRequest[],
      messages: ReadonlyMessages,
      running: boolean,
    ) {
      const { threadId } = agent;
      if (!threadId) return;
      const state = threadState(threadId);
      const turn = lastUserMessageId(messages);
      if (turn !== state.turn) {
        state.turn = turn;
        state.followUps = 0;
      }
      const isNew = (request: FunctionCallRequest) =>
        !state.done.has(request.functionCallId);
      const fresh = requests.filter(isNew);
      const answered = fresh.length > 0 ? answeredCallIds(messages) : new Set();
      for (const request of fresh) {
        const { functionCallId } = request;
        // The same id twice in one read runs once.
        if (state.done.has(functionCallId)) continue;
        state.done.add(functionCallId);
        if (answered.has(functionCallId)) continue;
        const isOverCap = state.followUps >= MAX_FUNCTION_FOLLOW_UPS;
        state.pending.push(
          isOverCap
            ? Promise.resolve(overCapAnswer(functionCallId))
            : answer(request),
        );
      }
      if (!running) void flush(agent, threadId, state);
    },
  };
}

/** Provider-side wiring: manager, dispatcher, agent subscriptions, envelope. */
export function useGenerativeUIRoot(
  copilotkit: CopilotKitCoreReact,
  config: GenerativeUIConfig | undefined,
): GenerativeUIRuntime | null {
  const configRef = useRef(config);
  configRef.current = config;
  const ui = config?.ui;
  const transport = config?.transport ?? "tool";
  const theme = useShallowStableRef(config?.theme);

  // The parts that live as long as `ui`. The surfaces are in the manager, so
  // a new theme or transport does not remount them.
  const core = useMemo(() => {
    if (!ui) return null;
    // Never throws: it is called from rendering, ingestion and event handlers,
    // and a throwing host `onError` must not break any of them.
    const reportError = (info: GenerativeUIErrorInfo) => {
      try {
        configRef.current?.errorBoundary?.onError?.(info);
      } catch (hostError) {
        if (isDevelopment()) {
          console.error(
            "[generativeUI] errorBoundary.onError threw:",
            hostError,
          );
        }
      }
      if (isDevelopment()) {
        console.warn(
          `[generativeUI] ${info.kind} error in ${info.surfaceId}${info.componentId ? `/${info.componentId}` : ""}: ${info.error?.message}`,
        );
      }
    };
    const manager = new GenerativeUISurfaceManager(ui, {
      onOperationRejected: ({ surfaceId, index, reason }) =>
        reportError({
          kind: "operation",
          surfaceId,
          error: new Error(`operation ${index} rejected: ${reason}`),
        }),
    });
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
      onError: ({ name, origin, error }) => {
        if ("functionCallId" in origin) {
          // The model gets this error in the answer of the call. The error
          // info of `onError` needs a surface, and this call has none.
          if (isDevelopment()) {
            console.warn(
              `[generativeUI] function call ${origin.functionCallId} to "${name}" failed: ${error.message}`,
            );
          }
          return;
        }
        reportError({ kind: "function", ...origin, error });
      },
    });
    const functionCalls = createFunctionCallRunner({
      copilotkit,
      dispatcher,
      manifest: { catalogId: ui.id, components: ui.manifestComponents },
    });
    const forwardEvent: GenerativeUIRuntime["forwardEvent"] = async (
      event,
      agentId,
    ) => {
      const fail = (message: string) => {
        const error = new GenerativeUIError("event_forward_failed", message);
        reportError({
          kind: "event",
          surfaceId: event.surfaceId,
          componentId: event.componentId,
          error,
        });
        return { ok: false as const, error };
      };
      const agent = copilotkit.getAgent(agentId ?? DEFAULT_AGENT_ID);
      if (!agent) {
        return fail(`No agent "${agentId}" to receive "${event.name}"`);
      }
      try {
        // A visible user message: the user and the model both see the event.
        const surface = agent.threadId
          ? manager.getSurface(agent.threadId, event.surfaceId)
          : undefined;
        const resolveLabel = surface
          ? createComponentLabelResolver(surfaceComponents(surface))
          : undefined;
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: buildActionMessageText(event, resolveLabel),
        });
        await copilotkit.runAgent({ agent });
        return { ok: true, result: undefined };
      } catch (cause) {
        return fail(
          `Forwarding "${event.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    };
    return {
      manager,
      dispatcher,
      ui,
      forwardEvent,
      reportError,
      functionCalls,
    };
  }, [ui, copilotkit]);

  // A new object when the theme or the transport changes, so that the
  // components that read them render again.
  const runtime = useMemo<GenerativeUIRuntime | null>(() => {
    if (!core) return null;
    const { manager, dispatcher, forwardEvent, reportError } = core;
    return {
      manager,
      dispatcher,
      ui: core.ui,
      forwardEvent,
      reportError,
      transport,
      theme,
      get config() {
        // `core` exists only while the provider has a config. After the
        // config is removed, nothing reads this runtime again.
        return configRef.current ?? { ui: core.ui };
      },
      get errorFallback() {
        return configRef.current?.errorBoundary?.fallback;
      },
    };
  }, [core, transport, theme]);

  useEffect(() => {
    if (!core) return;
    const watched = new WeakSet<AbstractAgent>();
    const agentSubscriptions: Array<{ unsubscribe(): void }> = [];
    let envelopeId: string | undefined;
    const removeEnvelope = () => {
      if (envelopeId === undefined) return;
      copilotkit.removeScopedProperties(envelopeId);
      envelopeId = undefined;
    };
    /**
     * The tool transport reads the surface activity messages. The markdown
     * transport reads the ```a2ui fences of the assistant messages, and
     * builds the surfaces of the thread from them again on each change.
     * Both give their function calls to the one runner.
     */
    const readMessages = (
      agent: AbstractAgent,
      messages: ReadonlyMessages,
      running: boolean,
    ) => {
      const requests = activityFunctionCalls(messages);
      const { threadId } = agent;
      if (configRef.current?.transport !== "markdown") {
        ingestMessages(core.manager, agent, messages);
      } else if (threadId) {
        // A thread switch can happen with no run start. The named targets
        // must show the surfaces of the thread that the messages belong to.
        core.manager.setActiveThread(threadId);
        const calls = getMarkdownSurfaceSource(core).sync(
          threadId,
          agent.agentId,
          messages,
          { running },
        );
        requests.push(...markdownFunctionCalls(calls));
      }
      core.functionCalls.run(agent, requests, messages, running);
    };
    const subscription = copilotkit.subscribe({
      // Core awaits this before it reads the properties for the run, so the
      // envelope set here goes with this run. Tool-call follow-up runs do not
      // fire it. The scoped entry stays until the next run start replaces it,
      // so the follow-up runs send the same envelope.
      onAgentRunStarted: ({ agent }) => {
        core.manager.setActiveThread(agent.threadId);
        const latest = configRef.current;
        if (latest) {
          removeEnvelope();
          const envelope = buildGenerativeUIEnvelope(
            core,
            agent.threadId,
            envelopeOptionsFor(latest),
          );
          envelopeId = copilotkit.addScopedProperties({
            properties: { [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: envelope } },
            agentIds: latest.agentIds,
          });
        }
        if (!watched.has(agent)) {
          watched.add(agent);
          agentSubscriptions.push(
            agent.subscribe({
              onMessagesChanged: ({ messages }) =>
                readMessages(agent, messages, agent.isRunning),
              // The last message is final now. An open fence in it is final
              // too, so its surface is no longer "streaming". The function
              // calls of the run get their answers now.
              onRunFinalized: () => readMessages(agent, agent.messages, false),
              onRunFailed: () => readMessages(agent, agent.messages, false),
            }),
          );
        }
        // The run starts now, but the agent is not marked as running yet.
        readMessages(agent, agent.messages, true);
      },
    });
    return () => {
      subscription.unsubscribe();
      for (const s of agentSubscriptions) s.unsubscribe();
      // Stop advertising a generative UI that is no longer mounted.
      removeEnvelope();
    };
  }, [core, copilotkit]);

  useGenerativeUIMarkdownContext(copilotkit, core, {
    enabled: config?.transport === "markdown" && config.sendContext !== false,
    agentIds: config?.agentIds,
  });

  return runtime;
}
