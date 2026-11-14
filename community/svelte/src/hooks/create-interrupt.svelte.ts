import { getContext, untrack } from "svelte";
import type { AbstractAgent } from "@ag-ui/client";
import { buildResumeArray, isInterruptExpired } from "@ag-ui/client";
import type { Interrupt, RunAgentResult } from "@ag-ui/client";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";
import { createAgent } from "./create-agent.svelte";
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
  | {
      kind: "legacy";
      event: InterruptEvent;
      owner: AbstractAgent;
      ownerVersion: number;
    }
  | {
      kind: "standard";
      interrupts: Interrupt[];
      owner: AbstractAgent;
      ownerVersion: number;
    };

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

export interface CreateInterruptConfig<TValue = unknown, TResult = never> {
  handler?: InterruptHandlerFn<TValue, TResult>;
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  agentId?: string | (() => string | undefined);
  renderInChat?: boolean;
}

export interface CreateInterruptResult<TValue = unknown, TResult = never> {
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

export function createInterrupt<TValue = unknown, TResult = never>(
  config: CreateInterruptConfig<TValue, TResult> = {},
): CreateInterruptResult<TValue, TResult> {
  const context = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!context) {
    throw new Error("createInterrupt must be used within CopilotKitProvider");
  }

  const agentHandle = createAgent({
    get agentId() {
      return typeof config.agentId === "function"
        ? config.agentId()
        : config.agentId;
    },
  });

  let pending = $state.raw<PendingInterrupt | null>(null);
  let result = $state<InterruptResult<TValue, TResult>>(null);
  const responses: Record<string, ResumeResponse> = {};
  let pendingAgentVersion: number | null = null;

  function clearResponses(): void {
    for (const key of Object.keys(responses)) delete responses[key];
  }

  $effect(() => {
    const ownerVersion = agentHandle.agentInstanceVersion;
    const resolvedAgent = untrack(() => agentHandle.agent);
    if (pendingAgentVersion !== ownerVersion) {
      pending = null;
      result = null;
      clearResponses();
      pendingAgentVersion = ownerVersion;
    }
    if (!resolvedAgent) {
      pending = null;
      result = null;
      return;
    }

    let localLegacy: InterruptEvent<TValue> | null = null;
    let localStandard: Interrupt[] | null = null;

    const subscription = resolvedAgent.subscribe({
      onCustomEvent: ({ event }) => {
        if (agentHandle.agentInstanceVersion !== ownerVersion) return;
        if (event.name === INTERRUPT_EVENT_NAME) {
          localLegacy = {
            name: event.name,
            value: event.value as TValue,
          };
        }
      },
      onRunFinishedEvent: (params) => {
        if (agentHandle.agentInstanceVersion !== ownerVersion) return;
        if (params.outcome === "interrupt") {
          localStandard = params.interrupts;
        }
      },
      onRunStartedEvent: () => {
        if (agentHandle.agentInstanceVersion !== ownerVersion) return;
        localLegacy = null;
        localStandard = null;
        clearResponses();
        if (pending?.ownerVersion === ownerVersion) pending = null;
      },
      onRunFinalized: () => {
        if (agentHandle.agentInstanceVersion !== ownerVersion) return;
        if (localStandard && localStandard.length > 0) {
          pending = {
            kind: "standard",
            interrupts: localStandard,
            owner: resolvedAgent,
            ownerVersion,
          };
        } else if (localLegacy) {
          pending = {
            kind: "legacy",
            event: localLegacy,
            owner: resolvedAgent,
            ownerVersion,
          };
        }
        localLegacy = null;
        localStandard = null;
      },
      onRunFailed: () => {
        if (agentHandle.agentInstanceVersion !== ownerVersion) return;
        localLegacy = null;
        localStandard = null;
        clearResponses();
        if (pending?.ownerVersion === ownerVersion) pending = null;
      },
    });

    return () => subscription.unsubscribe();
  });

  const submitStandardIfComplete = async (
    interrupts: Interrupt[],
    owner: AbstractAgent,
    ownerVersion: number,
  ): Promise<RunAgentResult | void> => {
    if (
      pending?.ownerVersion !== ownerVersion ||
      agentHandle.agentInstanceVersion !== ownerVersion
    ) {
      return;
    }
    const allAddressed = interrupts.every((i) => responses[i.id]);
    if (!allAddressed) return;

    const expired = interrupts.find((i) => isInterruptExpired(i));
    if (expired) {
      console.error(
        `[CopilotKit] createInterrupt: interrupt ${expired.id} expired at ${expired.expiresAt}; not resuming.`,
      );
      clearResponses();
      if (pending?.ownerVersion === ownerVersion) pending = null;
      return;
    }

    const resume = buildResumeArray(interrupts, responses);
    clearResponses();
    if (agentHandle.agentInstanceVersion !== ownerVersion) return;
    try {
      return await context.copilotkit.runAgent({
        agent: owner,
        resume,
      });
    } catch (err) {
      console.error(
        "[CopilotKit] createInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
        err,
      );
      if (pending?.ownerVersion === ownerVersion) pending = null;
      throw err;
    }
  };

  const resolve: InterruptResolveFn = async (payload?, interruptId?) => {
    const current = pending;
    if (!current) return;
    if (agentHandle.agentInstanceVersion !== current.ownerVersion) return;

    if (current.kind === "legacy") {
      try {
        return await context.copilotkit.runAgent({
          agent: current.owner,
          forwardedProps: {
            command: {
              resume: payload,
              interruptEvent: current.event.value,
            },
          },
        });
      } catch (err) {
        console.error(
          "[CopilotKit] createInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
          err,
        );
        if (pending?.ownerVersion === current.ownerVersion) pending = null;
        throw err;
      }
    }

    if (current.interrupts.length > 1 && interruptId === undefined) {
      console.warn(
        `[CopilotKit] createInterrupt: resolve() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first.`,
      );
    }
    const id = interruptId ?? current.interrupts[0]?.id;
    if (!id) return;
    responses[id] = { status: "resolved", payload };
    return submitStandardIfComplete(
      current.interrupts,
      current.owner,
      current.ownerVersion,
    );
  };

  const cancel: InterruptCancelFn = async (interruptId?) => {
    const current = pending;
    if (!current) return;
    if (agentHandle.agentInstanceVersion !== current.ownerVersion) return;

    if (current.kind === "legacy") {
      console.warn(
        "[CopilotKit] createInterrupt: cancel() is not supported for legacy on_interrupt interrupts; dismissing.",
      );
      pending = null;
      return;
    }

    if (current.interrupts.length > 1 && interruptId === undefined) {
      console.warn(
        `[CopilotKit] createInterrupt: cancel() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first.`,
      );
    }
    const id = interruptId ?? current.interrupts[0]?.id;
    if (!id) return;
    responses[id] = { status: "cancelled" };
    return submitStandardIfComplete(
      current.interrupts,
      current.owner,
      current.ownerVersion,
    );
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
    const ownerVersion = currentPending.ownerVersion;
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
          if (
            !cancelled &&
            agentHandle.agentInstanceVersion === ownerVersion &&
            pending?.ownerVersion === ownerVersion
          ) {
            result = resolved;
          }
        })
        .catch((err) => {
          if (
            !cancelled &&
            agentHandle.agentInstanceVersion === ownerVersion &&
            pending?.ownerVersion === ownerVersion
          ) {
            console.error("[CopilotKit] createInterrupt handler failed:", err);
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
