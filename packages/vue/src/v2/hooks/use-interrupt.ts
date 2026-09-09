import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type { Interrupt, RunAgentResult } from "@ag-ui/client";
import {
  ɵclearLegacyInterrupt,
  ɵreadLegacyInterrupt,
  ɵrecordLegacyInterrupt,
} from "@copilotkit/core";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useAgent } from "./use-agent";
import type {
  InterruptEvent,
  InterruptHandlerProps,
  InterruptRenderProps,
  InterruptResolveFn,
  InterruptCancelFn,
} from "../types/interrupt";

export type {
  InterruptEvent,
  InterruptHandlerProps,
  InterruptRenderProps,
  Interrupt,
};

const INTERRUPT_EVENT_NAME = "on_interrupt";

/** Internal accumulator response shape consumed by buildResumeArray. */
type ResumeResponse =
  | { status: "resolved"; payload?: unknown }
  | { status: "cancelled" };

/**
 * Normalized pending interrupt. `legacy` carries the custom-event payload;
 * `standard` carries the AG-UI `outcome:"interrupt"` interrupts array.
 */
type PendingInterrupt =
  | { kind: "legacy"; event: InterruptEvent }
  | { kind: "standard"; interrupts: Interrupt[] };

type InterruptHandlerFn<TValue, TResult> = (
  props: InterruptHandlerProps<TValue>,
) => TResult | PromiseLike<TResult>;

type InterruptResultFromHandler<THandler> = THandler extends (
  ...args: never[]
) => infer TResult
  ? TResult extends PromiseLike<infer TResolved>
    ? TResolved | null
    : TResult | null
  : null;

type InterruptResult<TValue, TResult> = InterruptResultFromHandler<
  InterruptHandlerFn<TValue, TResult>
>;

export interface UseInterruptConfig<TValue = unknown, TResult = never> {
  handler?: InterruptHandlerFn<TValue, TResult>;
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  agentId?: string;
  renderInChat?: boolean;
}

export interface UseInterruptResult<TValue = unknown, TResult = never> {
  interrupt: Ref<InterruptEvent<TValue> | null>;
  result: Ref<InterruptResult<TValue, TResult>>;
  hasInterrupt: ComputedRef<boolean>;
  /** Resolve the pending interrupt. Standard: records resolved response and submits when all addressed. Legacy: resumes via forwardedProps.command. */
  resolve: InterruptResolveFn;
  /** Alias of resolve for back-compat. */
  resolveInterrupt: InterruptResolveFn;
  /** Cancel the pending interrupt. Standard: records cancelled response and submits when all addressed. */
  cancel: InterruptCancelFn;
  /** Alias of cancel for back-compat. */
  cancelInterrupt: InterruptCancelFn;
  slotProps: ComputedRef<InterruptRenderProps<
    TValue,
    InterruptResult<TValue, TResult>
  > | null>;
}

export function isPromiseLike<TValue>(
  value: TValue | PromiseLike<TValue>,
): value is PromiseLike<TValue> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

function normalizeAsyncResult<TValue>(
  value: PromiseLike<TValue>,
): Promise<TValue> {
  if (value instanceof Promise) {
    return value;
  }

  return new Promise<TValue>((resolve, reject) => {
    try {
      value.then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

/** Derive the legacy-compatible `event` for any pending interrupt. */
function toLegacyEvent(pending: PendingInterrupt): InterruptEvent {
  if (pending.kind === "legacy") return pending.event;
  return { name: INTERRUPT_EVENT_NAME, value: pending.interrupts[0] };
}

/**
 * Vue composable for handling agent interrupts with optional filtering,
 * preprocessing, and resume behavior.
 *
 * Supports both the AG-UI standard interrupt flow (`RUN_FINISHED` with
 * `outcome:"interrupt"`) and the legacy custom-event flow (`on_interrupt`).
 * For standard interrupts, `slotProps` receives `interrupt` (the primary one)
 * and `interrupts` (the full open set); call `resolve(payload)` to resume or
 * `cancel()` to cancel. Resuming addresses the targeted interrupt and, once
 * every open interrupt is addressed, submits a single spec `resume` array via
 * `copilotkit.runAgent`.
 *
 * @example
 * ```ts
 * const { interrupt, hasInterrupt, resolve, cancel } = useInterrupt({
 *   handler: ({ event }) => ({ label: String(event.value) }),
 * });
 * ```
 */
export function useInterrupt<TValue = unknown, TResult = never>(
  config: UseInterruptConfig<TValue, TResult> = {},
): UseInterruptResult<TValue, TResult> {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: config.agentId });
  const pending = shallowRef<PendingInterrupt | null>(null);
  const result = shallowRef<InterruptResult<TValue, TResult>>(null);

  // Accumulated per-interrupt responses for the current standard interrupt set.
  const responses: Record<string, ResumeResponse> = {};
  // The run each open interrupt paused, so a resume addresses that run rather
  // than whichever request happened to open the stream.
  const interruptRunIds = new Map<string, string>();
  let legacyRunId: string | undefined;
  /**
   * The thread the pending gate belongs to. The app can switch threads on the
   * same agent instance without re-running the watcher, so a submit has to
   * prove the gate still belongs to the conversation on screen.
   */
  let pendingThreadId: string | undefined;

  /** Forget a gate the conversation on screen no longer owns. */
  const abandonIfThreadChanged = (resolvedAgent: {
    threadId: string;
  }): boolean => {
    if (
      pendingThreadId === undefined ||
      pendingThreadId === resolvedAgent.threadId
    ) {
      return false;
    }
    pendingThreadId = undefined;
    legacyRunId = undefined;
    interruptRunIds.clear();
    for (const k of Object.keys(responses)) {
      delete responses[k];
    }
    pending.value = null;
    result.value = null;
    return true;
  };

  watch(
    agent,
    (resolvedAgent, _previousAgent, onCleanup) => {
      if (!resolvedAgent) {
        pending.value = null;
        result.value = null;
        return;
      }

      let localLegacy: InterruptEvent<TValue> | null = null;
      let localStandard: Interrupt[] | null = null;
      let lastFinishedRunId: string | undefined;

      // Publish whatever this run collected. Standard wins if both somehow
      // appear for one run.
      const commit = (runId: string | undefined) => {
        if (localStandard && localStandard.length > 0) {
          pendingThreadId = resolvedAgent.threadId;
          pending.value = { kind: "standard", interrupts: localStandard };
        } else if (localLegacy) {
          pendingThreadId = resolvedAgent.threadId;
          legacyRunId = runId;
          // Record the legacy interrupt on the agent too. Standard interrupts
          // get this for free from `agent.pendingInterrupts`; without it the
          // legacy path cannot recover a gate whose event was already
          // delivered.
          ɵrecordLegacyInterrupt(resolvedAgent, {
            event: localLegacy,
            threadId: resolvedAgent.threadId,
            ...(runId === undefined ? {} : { runId }),
          });
          pending.value = { kind: "legacy", event: localLegacy };
        }
        localLegacy = null;
        localStandard = null;
      };

      const forget = () => {
        localLegacy = null;
        localStandard = null;
        lastFinishedRunId = undefined;
        legacyRunId = undefined;
        pendingThreadId = undefined;
        interruptRunIds.clear();
        ɵclearLegacyInterrupt(resolvedAgent);
        // Reset accumulated responses for the new run.
        for (const k of Object.keys(responses)) {
          delete responses[k];
        }
        pending.value = null;
      };

      const subscription = resolvedAgent.subscribe({
        onCustomEvent: ({ event }) => {
          if (event.name === INTERRUPT_EVENT_NAME) {
            localLegacy = {
              name: event.name,
              value: event.value as TValue,
            };
          }
        },
        onRunFinishedEvent: (params) => {
          // `params.event.runId` names the run that paused. `params.input.runId`
          // names the request that opened the stream, and on the connect path
          // that is the long-lived connection, not the replayed run.
          const runId = params.event.runId;
          lastFinishedRunId = runId;
          if (params.outcome === "interrupt") {
            for (const interrupt of params.interrupts) {
              interruptRunIds.set(interrupt.id, runId);
            }
            localStandard = params.interrupts;
          }
          // Commit here rather than only at `onRunFinalized`. On the connect
          // path `onRunFinalized` fires when the long-lived socket stream tears
          // down, not once per replayed run, so a reconnect that replays an
          // interrupt would otherwise surface nothing.
          commit(runId);
        },
        onRunStartedEvent: forget,
        // Fallback for a stream that ends without a RUN_FINISHED event. When
        // RUN_FINISHED did arrive, `commit` already ran and left nothing to do.
        // `onRunFinalized` carries no event, so it falls back to the last run
        // id RUN_FINISHED named and only then to the opening request.
        onRunFinalized: (params) =>
          commit(lastFinishedRunId ?? params.input.runId),
        onRunFailed: forget,
      });

      // Seed from what the client already knows this thread is waiting on, so
      // a mount or a reconnect surfaces a gate whose event arrived before this
      // subscription existed.
      const recordedLegacy = ɵreadLegacyInterrupt<TValue>(
        resolvedAgent,
        resolvedAgent.threadId,
      );
      if (resolvedAgent.pendingInterrupts.length > 0) {
        pendingThreadId = resolvedAgent.threadId;
        pending.value = {
          kind: "standard",
          interrupts: [...resolvedAgent.pendingInterrupts],
        };
      } else if (recordedLegacy) {
        pendingThreadId = recordedLegacy.threadId;
        legacyRunId = recordedLegacy.runId;
        pending.value = { kind: "legacy", event: recordedLegacy.event };
      } else {
        // This agent waits on nothing. State left over from the agent this
        // hook watched before must not survive the switch: the prompt would
        // stay on screen and send its answer to an agent that never asked.
        legacyRunId = undefined;
        pendingThreadId = undefined;
        interruptRunIds.clear();
        for (const k of Object.keys(responses)) {
          delete responses[k];
        }
        pending.value = null;
        result.value = null;
      }

      onCleanup(() => subscription.unsubscribe());
    },
    { immediate: true },
  );

  /** Submit the accumulated standard responses once all open interrupts are addressed. */
  const submitStandardIfComplete = async (
    interrupts: Interrupt[],
  ): Promise<RunAgentResult | void> => {
    const allAddressed = interrupts.every((i) => responses[i.id]);
    if (!allAddressed) return;

    const expired = interrupts.find((i) => isInterruptExpired(i));
    if (expired) {
      console.error(
        `[CopilotKit] useInterrupt: interrupt ${expired.id} expired at ${expired.expiresAt}; not resuming.`,
      );
      for (const k of Object.keys(responses)) {
        delete responses[k];
      }
      pending.value = null;
      return;
    }

    const resume = buildResumeArray(interrupts, responses);
    for (const k of Object.keys(responses)) {
      delete responses[k];
    }
    const runId = resume
      .map((entry) => interruptRunIds.get(entry.interruptId))
      .find((candidate): candidate is string => candidate !== undefined);
    const resolvedAgent = agent.value;
    if (!resolvedAgent) return;
    try {
      return await copilotkit.value.runAgent({
        agent: resolvedAgent,
        resume,
        ...(runId === undefined ? {} : { runId }),
      });
    } catch (err) {
      console.error(
        "[CopilotKit] useInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
        err,
      );
      pending.value = null;
      throw err;
    }
  };

  const resolve: InterruptResolveFn = async (payload?, interruptId?) => {
    const current = pending.value;
    if (!current) return;

    const resolvedAgent = agent.value;
    if (!resolvedAgent) return;
    if (abandonIfThreadChanged(resolvedAgent)) return;

    if (current.kind === "legacy") {
      const interruptEventValue = current.event.value;
      const runId = legacyRunId;
      try {
        return await copilotkit.value.runAgent({
          agent: resolvedAgent,
          ...(runId === undefined ? {} : { runId }),
          forwardedProps: {
            command: {
              resume: payload,
              interruptEvent: interruptEventValue,
            },
          },
        });
      } catch (err) {
        console.error(
          "[CopilotKit] useInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
          err,
        );
        pending.value = null;
        throw err;
      }
    }

    if (current.interrupts.length > 1 && interruptId === undefined) {
      console.warn(
        `[CopilotKit] useInterrupt: resolve()/cancel() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first. Pass an interruptId to address a specific interrupt.`,
      );
    }
    const id = interruptId ?? current.interrupts[0]?.id;
    if (!id) return;
    responses[id] = { status: "resolved", payload };
    return submitStandardIfComplete(current.interrupts);
  };

  const cancel: InterruptCancelFn = async (interruptId?) => {
    const current = pending.value;
    if (!current) return;

    const currentAgent = agent.value;
    if (currentAgent && abandonIfThreadChanged(currentAgent)) return;

    if (current.kind === "legacy") {
      // Legacy interrupts have no cancel semantics; dismiss without resuming.
      console.warn(
        "[CopilotKit] useInterrupt: cancel() is not supported for legacy on_interrupt interrupts; dismissing.",
      );
      // A dismissal ends the gate, so drop the recovery record with it.
      const dismissedAgent = agent.value;
      if (dismissedAgent) ɵclearLegacyInterrupt(dismissedAgent);
      pending.value = null;
      return;
    }

    if (current.interrupts.length > 1 && interruptId === undefined) {
      console.warn(
        `[CopilotKit] useInterrupt: resolve()/cancel() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first. Pass an interruptId to address a specific interrupt.`,
      );
    }
    const id = interruptId ?? current.interrupts[0]?.id;
    if (!id) return;
    responses[id] = { status: "cancelled" };
    return submitStandardIfComplete(current.interrupts);
  };

  // Keep resolveInterrupt and cancelInterrupt as aliases for back-compat.
  const resolveInterrupt: InterruptResolveFn = resolve;
  const cancelInterrupt: InterruptCancelFn = cancel;

  watch(
    pending,
    (currentPending, _previous, onCleanup) => {
      if (!currentPending) {
        result.value = null;
        return;
      }
      const legacyEvent = toLegacyEvent(
        currentPending,
      ) as InterruptEvent<TValue>;
      if (config.enabled && !config.enabled(legacyEvent)) {
        result.value = null;
        return;
      }
      const handler = config.handler;
      if (!handler) {
        result.value = null;
        return;
      }

      let cancelled = false;
      const maybePromise = handler({
        event: legacyEvent,
        interrupt:
          currentPending.kind === "standard"
            ? (currentPending.interrupts[0] ?? null)
            : null,
        interrupts:
          currentPending.kind === "standard" ? currentPending.interrupts : [],
        resolve,
        cancel,
      });

      if (isPromiseLike(maybePromise)) {
        normalizeAsyncResult(maybePromise)
          .then((resolved) => {
            if (!cancelled) {
              result.value = resolved;
            }
          })
          .catch((err) => {
            if (!cancelled) {
              console.error("[CopilotKit] useInterrupt handler failed:", err);
              result.value = null;
            }
          });
      } else {
        result.value = maybePromise;
      }

      onCleanup(() => {
        cancelled = true;
      });
    },
    { immediate: true },
  );

  // Compute the legacy-compat "interrupt" ref for existing consumers (InterruptEvent shape).
  const interrupt = computed<InterruptEvent<TValue> | null>(() => {
    if (!pending.value) return null;
    return toLegacyEvent(pending.value) as InterruptEvent<TValue>;
  });

  const slotProps = computed<InterruptRenderProps<
    TValue,
    InterruptResult<TValue, TResult>
  > | null>(() => {
    const currentPending = pending.value;
    if (!currentPending) return null;
    const legacyEvent = toLegacyEvent(currentPending) as InterruptEvent<TValue>;
    if (config.enabled && !config.enabled(legacyEvent)) return null;

    return {
      event: legacyEvent,
      interrupt:
        currentPending.kind === "standard"
          ? (currentPending.interrupts[0] ?? null)
          : null,
      interrupts:
        currentPending.kind === "standard" ? currentPending.interrupts : [],
      result: result.value,
      resolve,
      cancel,
    };
  });

  watch(
    [() => copilotkit.value, slotProps, () => config.renderInChat !== false],
    ([core, nextSlotProps, shouldRenderInChat], _previous, onCleanup) => {
      if (!shouldRenderInChat) {
        return;
      }

      core.setInterruptState(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nextSlotProps as InterruptRenderProps<any, any> | null,
      );
      const publishedState = nextSlotProps;

      onCleanup(() => {
        if (core.interruptState === publishedState) {
          core.setInterruptState(null);
        }
      });
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    const core = copilotkit.value;
    if (
      config.renderInChat !== false &&
      core.interruptState === slotProps.value
    ) {
      core.setInterruptState(null);
    }
  });

  return {
    interrupt: interrupt as unknown as Ref<InterruptEvent<TValue> | null>,
    result: result as Ref<InterruptResult<TValue, TResult>>,
    hasInterrupt: computed(() => slotProps.value !== null),
    resolve,
    resolveInterrupt,
    cancel,
    cancelInterrupt,
    slotProps: slotProps as ComputedRef<InterruptRenderProps<
      TValue,
      InterruptResult<TValue, TResult>
    > | null>,
  };
}
