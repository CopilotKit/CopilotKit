import { getContext } from "svelte";
import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type { Interrupt, RunAgentResult } from "@ag-ui/client";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import { useAgent } from "./use-agent.svelte";
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

type ResumeResponse =
  | { status: "resolved"; payload?: unknown }
  | { status: "cancelled" };

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
  interrupt: InterruptEvent<TValue> | null;
  result: InterruptResult<TValue, TResult>;
  hasInterrupt: boolean;
  resolve: InterruptResolveFn;
  resolveInterrupt: InterruptResolveFn;
  cancel: InterruptCancelFn;
  cancelInterrupt: InterruptCancelFn;
  slotProps: InterruptRenderProps<
    TValue,
    InterruptResult<TValue, TResult>
  > | null;
}

function isPromiseLike<TValue>(
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
  if (value instanceof Promise) return value;
  return new Promise<TValue>((resolve, reject) => {
    try {
      value.then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function toLegacyEvent(pending: PendingInterrupt): InterruptEvent {
  if (pending.kind === "legacy") return pending.event;
  return { name: INTERRUPT_EVENT_NAME, value: pending.interrupts[0] };
}

export function useInterrupt<TValue = unknown, TResult = never>(
  config: UseInterruptConfig<TValue, TResult> = {},
): UseInterruptResult<TValue, TResult> {
  const context = getContext<CopilotKitContextValue>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("useInterrupt must be used within CopilotKitProvider");
  }

  const { agent } = useAgent({ agentId: config.agentId });

  let pending = $state<PendingInterrupt | null>(null);
  let result = $state<InterruptResult<TValue, TResult>>(null);
  const responses: Record<string, ResumeResponse> = {};

  $effect(() => {
    const resolvedAgent = agent;
    if (!resolvedAgent) {
      pending = null;
      result = null;
      return;
    }

    let localLegacy: InterruptEvent<TValue> | null = null;
    let localStandard: Interrupt[] | null = null;

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
        if (params.outcome === "interrupt") {
          localStandard = params.interrupts;
        }
      },
      onRunStartedEvent: () => {
        localLegacy = null;
        localStandard = null;
        for (const k of Object.keys(responses)) {
          delete responses[k];
        }
        pending = null;
      },
      onRunFinalized: () => {
        if (localStandard && localStandard.length > 0) {
          pending = { kind: "standard", interrupts: localStandard };
        } else if (localLegacy) {
          pending = { kind: "legacy", event: localLegacy };
        }
        localLegacy = null;
        localStandard = null;
      },
      onRunFailed: () => {
        localLegacy = null;
        localStandard = null;
        for (const k of Object.keys(responses)) {
          delete responses[k];
        }
        pending = null;
      },
    });

    return () => subscription.unsubscribe();
  });

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
      pending = null;
      return;
    }

    const resume = buildResumeArray(interrupts, responses);
    for (const k of Object.keys(responses)) {
      delete responses[k];
    }
    const resolvedAgent = agent;
    if (!resolvedAgent) return;
    try {
      return await context.copilotkit.runAgent({
        agent: resolvedAgent,
        resume,
      });
    } catch (err) {
      console.error(
        "[CopilotKit] useInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
        err,
      );
      pending = null;
      throw err;
    }
  };

  const resolve: InterruptResolveFn = async (payload?, interruptId?) => {
    const current = pending;
    if (!current) return;
    const resolvedAgent = agent;
    if (!resolvedAgent) return;

    if (current.kind === "legacy") {
      try {
        return await context.copilotkit.runAgent({
          agent: resolvedAgent,
          forwardedProps: {
            command: {
              resume: payload,
              interruptEvent: current.event.value,
            },
          },
        });
      } catch (err) {
        console.error(
          "[CopilotKit] useInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
          err,
        );
        pending = null;
        throw err;
      }
    }

    if (current.interrupts.length > 1 && interruptId === undefined) {
      console.warn(
        `[CopilotKit] useInterrupt: resolve() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first.`,
      );
    }
    const id = interruptId ?? current.interrupts[0]?.id;
    if (!id) return;
    responses[id] = { status: "resolved", payload };
    return submitStandardIfComplete(current.interrupts);
  };

  const cancel: InterruptCancelFn = async (interruptId?) => {
    const current = pending;
    if (!current) return;

    if (current.kind === "legacy") {
      console.warn(
        "[CopilotKit] useInterrupt: cancel() is not supported for legacy on_interrupt interrupts; dismissing.",
      );
      pending = null;
      return;
    }

    if (current.interrupts.length > 1 && interruptId === undefined) {
      console.warn(
        `[CopilotKit] useInterrupt: cancel() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first.`,
      );
    }
    const id = interruptId ?? current.interrupts[0]?.id;
    if (!id) return;
    responses[id] = { status: "cancelled" };
    return submitStandardIfComplete(current.interrupts);
  };

  const resolveInterrupt: InterruptResolveFn = resolve;
  const cancelInterrupt: InterruptCancelFn = cancel;

  $effect(() => {
    const currentPending = pending;
    if (!currentPending) {
      result = null;
      return;
    }
    const legacyEvent = toLegacyEvent(currentPending) as InterruptEvent<TValue>;
    if (config.enabled && !config.enabled(legacyEvent)) {
      result = null;
      return;
    }
    const handler = config.handler;
    if (!handler) {
      result = null;
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
            result = resolved;
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("[CopilotKit] useInterrupt handler failed:", err);
            result = null;
          }
        });
    } else {
      result = maybePromise;
    }

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const core = context.copilotkit;
    const currentPending = pending;
    if (!currentPending) {
      core.setInterruptState(null);
      return;
    }
    const legacyEvent = toLegacyEvent(currentPending) as InterruptEvent<TValue>;
    if (config.enabled && !config.enabled(legacyEvent)) {
      core.setInterruptState(null);
      return;
    }

    const slotProps: InterruptRenderProps<
      TValue,
      InterruptResult<TValue, TResult>
    > = {
      event: legacyEvent,
      interrupt:
        currentPending.kind === "standard"
          ? (currentPending.interrupts[0] ?? null)
          : null,
      interrupts:
        currentPending.kind === "standard" ? currentPending.interrupts : [],
      result: result,
      resolve,
      cancel,
    };

    core.setInterruptState(
      slotProps as unknown as InterruptRenderProps<unknown, unknown>,
    );

    return () => {
      if (core.interruptState === slotProps) {
        core.setInterruptState(null);
      }
    };
  });

  const interrupt = $derived(
    pending ? (toLegacyEvent(pending) as InterruptEvent<TValue>) : null,
  );

  const hasInterrupt = $derived(pending !== null);

  const slotProps = $derived.by<InterruptRenderProps<
    TValue,
    InterruptResult<TValue, TResult>
  > | null>(() => {
    const currentPending = pending;
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
      result: result,
      resolve,
      cancel,
    };
  });

  return {
    get interrupt() {
      return interrupt;
    },
    get result() {
      return result;
    },
    get hasInterrupt() {
      return hasInterrupt;
    },
    resolve,
    resolveInterrupt,
    cancel,
    cancelInterrupt,
    get slotProps() {
      return slotProps;
    },
  };
}
