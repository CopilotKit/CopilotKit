import type { AbstractAgent, Message } from "@ag-ui/client";
import type { CopilotKitCore } from "@copilotkit/core";
import {
  A2UI_VERSION,
  GENERATIVE_UI_FUNCTION_CALL_ACTIVITY_TYPE,
  randomUUID,
  validateOperation,
} from "@copilotkit/shared";
import type {
  A2UIOperation,
  ValidateOperationOptions,
} from "@copilotkit/shared";
import type {
  GenerativeUIDispatcher,
  MarkdownFunctionCall,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUIErrorCode } from "@copilotkit/shared/generative-ui";

// The function calls of the agent (`callRendererFunction`), for both
// transports. The same rules as React's root hook: each call runs once per
// thread, the answers are hidden developer messages, they go to the agent
// only when it is idle, and a user turn gets at most MAX_FUNCTION_FOLLOW_UPS
// follow-up runs.

/** At most this many function follow-up runs for each user turn. */
export const MAX_FUNCTION_FOLLOW_UPS = 5;

export type ReadonlyMessages = ReadonlyArray<Readonly<Message>>;

/** One agent-called function, as the model sent it. */
export interface FunctionCallRequest {
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

/** What the runner keeps for the function calls of one thread. */
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
export function activityFunctionCalls(messages: ReadonlyMessages) {
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
export function markdownFunctionCalls(calls: MarkdownFunctionCall[]) {
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

export interface FunctionCallRunnerOptions {
  core: CopilotKitCore;
  dispatcher: GenerativeUIDispatcher;
  manifest: ValidateOperationOptions["manifest"];
  /**
   * Lets the app apply the state that the handlers set before the follow-up
   * run reads it. The Angular root runs a change detection tick.
   */
  settle: () => Promise<void>;
  /** Gets a failed follow-up run. Development only. */
  warn: (message: string, error: unknown) => void;
}

export interface FunctionCallRunner {
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
  ): void;
}

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
export function createFunctionCallRunner(
  options: FunctionCallRunnerOptions,
): FunctionCallRunner {
  const { core, dispatcher, manifest, settle, warn } = options;
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
        // Let the app apply the state that the handlers set, so that the
        // follow-up run reads it.
        await settle();
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
        await core.runAgent({ agent });
      }
    } catch (error) {
      warn("[generativeUI] function follow-up run failed:", error);
    } finally {
      state.flushing = false;
    }
  };

  return {
    run(agent, requests, messages, running) {
      const { threadId } = agent;
      if (!threadId) return;
      const state = threadState(threadId);
      const turn = lastUserMessageId(messages);
      if (turn !== state.turn) {
        state.turn = turn;
        state.followUps = 0;
      }
      const fresh = requests.filter(
        (request) => !state.done.has(request.functionCallId),
      );
      const answered =
        fresh.length > 0 ? answeredCallIds(messages) : new Set<string>();
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
