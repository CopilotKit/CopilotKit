import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  buildResumeArray,
  isInterruptExpired,
  randomUUID,
} from "@ag-ui/client";
import type { Interrupt, Message, RunAgentResult } from "@ag-ui/client";
import { useCopilotKit } from "../context";
import { useAgent } from "./use-agent";
import type {
  InterruptEvent,
  InterruptRenderProps,
  InterruptHandlerProps,
  InterruptResolveFn,
  InterruptCancelFn,
} from "../types/interrupt";

export type {
  InterruptEvent,
  InterruptRenderProps,
  InterruptHandlerProps,
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

type InterruptRenderInChat = boolean | undefined;

type UseInterruptReturn<TRenderInChat extends InterruptRenderInChat> =
  TRenderInChat extends false
    ? React.ReactElement | null
    : TRenderInChat extends true | undefined
      ? void
      : React.ReactElement | null | void;

export function isPromiseLike<TValue>(
  value: TValue | PromiseLike<TValue>,
): value is PromiseLike<TValue> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

/** Derive the legacy-compatible `event` for any pending interrupt. */
function toLegacyEvent(pending: PendingInterrupt): InterruptEvent {
  if (pending.kind === "legacy") return pending.event;
  return { name: INTERRUPT_EVENT_NAME, value: pending.interrupts[0] };
}

/**
 * Configuration options for `useInterrupt`.
 */
interface UseInterruptConfigBase<TValue = unknown, TResult = never> {
  /**
   * Render function for the interrupt UI.
   *
   * Receives both the standard `interrupt`/`interrupts` and the legacy `event`.
   * Call `resolve(payload)` to resume with user input, or `cancel()` to cancel.
   */
  render: (
    props: InterruptRenderProps<TValue, InterruptResult<TValue, TResult>>,
  ) => React.ReactElement;
  /**
   * Optional pre-render handler invoked when an interrupt is received.
   * Return a sync or async value to expose as `result` in `render`.
   * Rejecting/throwing falls back to `result = null`.
   */
  handler?: InterruptHandlerFn<TValue, TResult>;
  /**
   * Optional predicate to filter which interrupts this hook handles.
   * Receives the legacy-compatible event (for standard interrupts, `value` is
   * the primary `Interrupt`). Return `false` to ignore.
   */
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  /** Optional agent id. Defaults to the current configured chat agent. */
  agentId?: string;
}

export interface UseInterruptInChatConfig<
  TValue = unknown,
  TResult = never,
> extends UseInterruptConfigBase<TValue, TResult> {
  /** When true (default), the interrupt UI renders inside `<CopilotChat>` automatically. */
  renderInChat?: true;
}

export interface UseInterruptExternalConfig<
  TValue = unknown,
  TResult = never,
> extends UseInterruptConfigBase<TValue, TResult> {
  /** When false, the hook returns the interrupt element so you can place it yourself. */
  renderInChat: false;
}

export interface UseInterruptDynamicConfig<
  TValue = unknown,
  TResult = never,
> extends UseInterruptConfigBase<TValue, TResult> {
  /** Dynamic boolean mode. When non-literal, return type is a union. */
  renderInChat: boolean;
}

export type UseInterruptConfig<
  TValue = unknown,
  TResult = never,
  TRenderInChat extends InterruptRenderInChat = undefined,
> = UseInterruptConfigBase<TValue, TResult> & {
  /** When true (default), the interrupt UI renders inside `<CopilotChat>` automatically. */
  renderInChat?: TRenderInChat;
};

/**
 * Handles agent interrupts with optional filtering, preprocessing, and resume behavior.
 *
 * Supports both the AG-UI standard interrupt flow (`RUN_FINISHED` with
 * `outcome.type === "interrupt"`) and the legacy custom-event flow
 * (`on_interrupt`). For standard interrupts, `render` receives `interrupt`
 * (the primary one) and `interrupts` (the full open set); call `resolve(payload)`
 * to resume or `cancel()` to cancel. Resuming addresses the targeted interrupt
 * and, once every open interrupt is addressed, submits a single spec `resume`
 * array via `copilotkit.runAgent`.
 *
 * - `renderInChat: true` (default): the element is published into `<CopilotChat>`; returns `void`.
 * - `renderInChat: false`: the hook returns the interrupt element for manual placement.
 *
 * @example
 * ```tsx
 * useInterrupt({
 *   render: ({ interrupt, resolve, cancel }) => (
 *     <div>
 *       <p>{interrupt?.message}</p>
 *       <button onClick={() => resolve({ approved: true })}>Approve</button>
 *       <button onClick={() => cancel()}>Cancel</button>
 *     </div>
 *   ),
 * });
 * ```
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function useInterrupt<
  TResult = never,
  TRenderInChat extends InterruptRenderInChat = undefined,
>(
  config: UseInterruptConfig<any, TResult, TRenderInChat>,
): UseInterruptReturn<TRenderInChat> {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: config.agentId });
  const [pending, setPending] = useState<PendingInterrupt | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [handlerResult, setHandlerResult] =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useState<InterruptResult<any, TResult>>(null);

  // Accumulated per-interrupt responses for the current standard interrupt set.
  const responsesRef = useRef<Record<string, ResumeResponse>>({});

  useEffect(() => {
    let localLegacy: InterruptEvent | null = null;
    let localStandard: Interrupt[] | null = null;

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          localLegacy = { name: event.name, value: event.value };
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
        responsesRef.current = {};
        setPending(null);
      },
      onRunFinalized: () => {
        // Standard wins if both somehow appear for one run.
        if (localStandard && localStandard.length > 0) {
          setPending({ kind: "standard", interrupts: localStandard });
        } else if (localLegacy) {
          setPending({ kind: "legacy", event: localLegacy });
        }
        localLegacy = null;
        localStandard = null;
      },
      onRunFailed: () => {
        localLegacy = null;
        localStandard = null;
        responsesRef.current = {};
        setPending(null);
      },
    });

    return () => subscription.unsubscribe();
  }, [agent]);

  // Submit the accumulated standard responses once all open interrupts are
  // addressed; otherwise return void and keep waiting.
  const submitStandardIfComplete = useCallback(
    async (interrupts: Interrupt[]): Promise<RunAgentResult | void> => {
      const allAddressed = interrupts.every((i) => responsesRef.current[i.id]);
      if (!allAddressed) return;

      const expired = interrupts.find((i) => isInterruptExpired(i));
      if (expired) {
        console.error(
          `[CopilotKit] useInterrupt: interrupt ${expired.id} expired at ${expired.expiresAt}; not resuming.`,
        );
        responsesRef.current = {};
        setPending(null);
        return;
      }

      const resume = buildResumeArray(interrupts, responsesRef.current);

      // Persist each resolution as a tool-result message so the conversation
      // stays well-formed on later turns. The interrupt run left the tool call
      // unanswered; without recording its result here, the NEXT turn ships a
      // dangling tool call (assistant tool-call with no tool result) and the
      // model errors / re-calls the tool in a loop. Only standard, tool-backed
      // interrupts carry a `toolCallId`; custom `ctx.interrupt()` ones don't and
      // are resumed purely via the `resume` array.
      for (const i of interrupts) {
        if (!i.toolCallId) continue;
        const response = responsesRef.current[i.id];
        const content =
          response.status === "cancelled"
            ? { status: "cancelled" }
            : (response.payload ?? { status: "resolved" });
        agent.addMessage({
          id: randomUUID(),
          role: "tool",
          toolCallId: i.toolCallId,
          content: JSON.stringify(content),
        } as Message);
      }

      responsesRef.current = {};
      try {
        return await copilotkit.runAgent({ agent, resume });
      } catch (err) {
        console.error(
          "[CopilotKit] useInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
          err,
        );
        setPending(null);
        throw err;
      }
    },
    [agent, copilotkit],
  );

  const resolve: InterruptResolveFn = useCallback(
    async (payload, interruptId) => {
      const current = pendingRef.current;
      if (!current) return;

      if (current.kind === "legacy") {
        try {
          return await copilotkit.runAgent({
            agent,
            forwardedProps: {
              command: { resume: payload, interruptEvent: current.event.value },
            },
          });
        } catch (err) {
          console.error(
            "[CopilotKit] useInterrupt resolve: runAgent rejected; clearing pending + rethrowing",
            err,
          );
          setPending(null);
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
      responsesRef.current[id] = { status: "resolved", payload };
      return submitStandardIfComplete(current.interrupts);
    },
    [agent, copilotkit, submitStandardIfComplete],
  );

  const cancel: InterruptCancelFn = useCallback(
    async (interruptId) => {
      const current = pendingRef.current;
      if (!current) return;

      if (current.kind === "legacy") {
        // Legacy interrupts have no cancel semantics; dismiss without resuming.
        console.warn(
          "[CopilotKit] useInterrupt: cancel() is not supported for legacy on_interrupt interrupts; dismissing.",
        );
        setPending(null);
        return;
      }

      if (current.interrupts.length > 1 && interruptId === undefined) {
        console.warn(
          `[CopilotKit] useInterrupt: resolve()/cancel() called without an interruptId while ${current.interrupts.length} interrupts are open; defaulting to the first. Pass an interruptId to address a specific interrupt.`,
        );
      }
      const id = interruptId ?? current.interrupts[0]?.id;
      if (!id) return;
      responsesRef.current[id] = { status: "cancelled" };
      return submitStandardIfComplete(current.interrupts);
    },
    [submitStandardIfComplete],
  );

  // Stabilize consumer-supplied callbacks behind refs so inline lambdas do not
  // churn the element memo identity or the handler effect.
  const renderRef = useRef(config.render);
  renderRef.current = config.render;
  const enabledRef = useRef(config.enabled);
  enabledRef.current = config.enabled;
  const handlerRef = useRef(config.handler);
  handlerRef.current = config.handler;
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  // Predicate evaluator: a throw is treated as "disabled" (false) and logged.
  const isEnabled = (event: InterruptEvent): boolean => {
    const predicate = enabledRef.current;
    if (!predicate) return true;
    try {
      return predicate(event);
    } catch (err) {
      console.error(
        "[CopilotKit] useInterrupt enabled predicate threw; treating interrupt as disabled:",
        err,
      );
      return false;
    }
  };

  useEffect(() => {
    if (!pending) {
      setHandlerResult(null);
      return;
    }
    const legacyEvent = toLegacyEvent(pending);
    if (!isEnabled(legacyEvent)) {
      setHandlerResult(null);
      return;
    }
    const handler = handlerRef.current;
    if (!handler) {
      setHandlerResult(null);
      return;
    }

    let cancelled = false;
    let maybePromise: ReturnType<typeof handler>;
    try {
      maybePromise = handler({
        event: legacyEvent,
        interrupt: pending.kind === "standard" ? pending.interrupts[0] : null,
        interrupts: pending.kind === "standard" ? pending.interrupts : [],
        resolve: resolveRef.current,
        cancel: cancelRef.current,
      });
    } catch (err) {
      console.error(
        "[CopilotKit] useInterrupt handler threw; result will be null:",
        err,
      );
      if (!cancelled) setHandlerResult(null);
      return () => {
        cancelled = true;
      };
    }

    if (isPromiseLike(maybePromise)) {
      Promise.resolve(maybePromise)
        .then((resolved) => {
          if (!cancelled) setHandlerResult(resolved);
        })
        .catch((err) => {
          console.error(
            "[CopilotKit] useInterrupt handler rejected; result will be null:",
            err,
          );
          if (!cancelled) setHandlerResult(null);
        });
    } else {
      setHandlerResult(maybePromise);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const element = useMemo(() => {
    if (!pending) return null;
    const legacyEvent = toLegacyEvent(pending);
    if (!isEnabled(legacyEvent)) return null;

    return renderRef.current({
      event: legacyEvent,
      interrupt: pending.kind === "standard" ? pending.interrupts[0] : null,
      interrupts: pending.kind === "standard" ? pending.interrupts : [],
      result: handlerResult,
      resolve,
      cancel,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, handlerResult, resolve, cancel]);

  // Publish to core for in-chat rendering. Publish-only.
  useEffect(() => {
    if (config.renderInChat === false) return;
    copilotkit.setInterruptElement(element);
  }, [element, config.renderInChat, copilotkit]);

  // Nullify on true unmount only.
  useEffect(() => {
    if (config.renderInChat === false) return;
    return () => {
      copilotkit.setInterruptElement(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (config.renderInChat === false) {
    return element as UseInterruptReturn<TRenderInChat>;
  }

  return undefined as UseInterruptReturn<TRenderInChat>;
}
