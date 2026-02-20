import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useAgent } from "./use-agent";
import type {
  InterruptEvent,
  InterruptRenderProps,
  InterruptHandlerProps,
} from "../types/interrupt";

export type { InterruptEvent, InterruptRenderProps, InterruptHandlerProps };

const INTERRUPT_EVENT_NAME = "on_interrupt";

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

/**
 * Configuration options for `useInterrupt`.
 */
interface UseInterruptConfigBase<TValue = unknown, TResult = never> {
  /**
   * Render function for the interrupt UI.
   *
   * This is called once an interrupt is finalized and accepted by `enabled` (if provided).
   * Use `resolve` from render props to resume the agent run with user input.
   */
  render: (
    props: InterruptRenderProps<TValue, InterruptResult<TValue, TResult>>,
  ) => React.ReactElement;
  /**
   * Optional pre-render handler invoked when an interrupt is received.
   *
   * Return either a sync value or an async value to pass into `render` as `result`.
   * Rejecting/throwing falls back to `result = null`.
   */
  handler?: InterruptHandlerFn<TValue, TResult>;
  /**
   * Optional predicate to filter which interrupts should be handled by this hook.
   * Return `false` to ignore an interrupt.
   */
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  /** Optional agent id. Defaults to the current configured chat agent. */
  agentId?: string;
}

export interface UseInterruptInChatConfig<
  TValue = unknown,
  TResult = never,
> extends UseInterruptConfigBase<TValue, TResult> {
  /** When true (default), the interrupt UI renders inside `<CopilotChat>` automatically. Set to false to render it yourself. */
  renderInChat?: true;
}

export interface UseInterruptExternalConfig<
  TValue = unknown,
  TResult = never,
> extends UseInterruptConfigBase<TValue, TResult> {
  /** When true (default), the interrupt UI renders inside `<CopilotChat>` automatically. Set to false to render it yourself. */
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
  /** When true (default), the interrupt UI renders inside `<CopilotChat>` automatically. Set to false to render it yourself. */
  renderInChat?: TRenderInChat;
};

/**
 * Handles agent interrupts (`on_interrupt`) with optional filtering, preprocessing, and resume behavior.
 *
 * The hook listens to custom events on the active agent, stores interrupt payloads per run,
 * and surfaces a render callback once the run finalizes. Call `resolve` from your UI to resume
 * execution with user-provided data.
 *
 * - `renderInChat: true` (default): the element is published into `<CopilotChat>` and this hook returns `void`.
 * - `renderInChat: false`: the hook returns the interrupt element so you can place it anywhere in your component tree.
 *
 * `event.value` is typed as `any` since the interrupt payload shape depends on your agent.
 * Type-narrow it in your callbacks (e.g. `handler`, `enabled`, `render`) as needed.
 *
 * @typeParam TResult - Inferred from `handler` return type. Exposed as `result` in `render`.
 * @param config - Interrupt configuration (renderer, optional handler/filter, and render mode).
 * @returns When `renderInChat` is `false`, returns the interrupt element (or `null` when idle).
 * Otherwise returns `void` and publishes the element into chat. In `render`, `result` is always
 * either the handler's resolved return value or `null` (including when no handler is provided,
 * when filtering skips the interrupt, or when handler execution fails).
 *
 * @example
 * ```tsx
 * import { useInterrupt } from "@copilotkitnext/react";
 *
 * function InterruptUI() {
 *   useInterrupt({
 *     render: ({ event, resolve }) => (
 *       <div>
 *         <p>{event.value.question}</p>
 *         <button onClick={() => resolve({ approved: true })}>Approve</button>
 *         <button onClick={() => resolve({ approved: false })}>Reject</button>
 *       </div>
 *     ),
 *   });
 *
 *   return null;
 * }
 * ```
 *
 * @example
 * ```tsx
 * import { useInterrupt } from "@copilotkitnext/react";
 *
 * function CustomPanel() {
 *   const interruptElement = useInterrupt({
 *     renderInChat: false,
 *     enabled: (event) => event.value.startsWith("approval:"),
 *     handler: async ({ event }) => ({ label: event.value.toUpperCase() }),
 *     render: ({ event, result, resolve }) => (
 *       <aside>
 *         <strong>{result?.label ?? ""}</strong>
 *         <button onClick={() => resolve({ value: event.value })}>Continue</button>
 *       </aside>
 *     ),
 *   });
 *
 *   return <>{interruptElement}</>;
 * }
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
  const [pendingEvent, setPendingEvent] = useState<InterruptEvent | null>(null);
  const [handlerResult, setHandlerResult] =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useState<InterruptResult<any, TResult>>(null);

  useEffect(() => {
    let localInterrupt: InterruptEvent | null = null;

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          localInterrupt = { name: event.name, value: event.value };
        }
      },
      onRunStartedEvent: () => {
        localInterrupt = null;
        setPendingEvent(null);
      },
      onRunFinalized: () => {
        if (localInterrupt) {
          setPendingEvent(localInterrupt);
          localInterrupt = null;
        }
      },
      onRunFailed: () => {
        localInterrupt = null;
      },
    });

    return () => subscription.unsubscribe();
  }, [agent]);

  const resolve = useCallback(
    (response: unknown) => {
      setPendingEvent(null);
      copilotkit.runAgent({
        agent,
        forwardedProps: { command: { resume: response } },
      });
    },
    [agent, copilotkit],
  );

  useEffect(() => {
    // No interrupt to process — reset any stale handler result from a previous interrupt
    if (!pendingEvent) {
      setHandlerResult(null);
      return;
    }
    // Interrupt exists but the consumer's filter rejects it — treat as no-op
    if (config.enabled && !config.enabled(pendingEvent)) {
      setHandlerResult(null);
      return;
    }
    const handler = config.handler;
    // No handler provided — skip straight to rendering with a null result
    if (!handler) {
      setHandlerResult(null);
      return;
    }

    let cancelled = false;
    const maybePromise = handler({
      event: pendingEvent,
      resolve,
    });

    // If the handler returns a promise/thenable, wait for resolution before setting result.
    if (isPromiseLike(maybePromise)) {
      Promise.resolve(maybePromise)
        .then((resolved) => {
          if (!cancelled) setHandlerResult(resolved);
        })
        .catch(() => {
          if (!cancelled) setHandlerResult(null);
        });
    } else {
      setHandlerResult(maybePromise);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEvent, config.enabled, config.handler, resolve]);

  const element = useMemo(() => {
    if (!pendingEvent) return null;
    if (config.enabled && !config.enabled(pendingEvent)) return null;

    return config.render({
      event: pendingEvent,
      result: handlerResult,
      resolve,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEvent, handlerResult, config.enabled, config.render, resolve]);

  // Publish to core for in-chat rendering
  useEffect(() => {
    if (config.renderInChat === false) return;
    copilotkit.setInterruptElement(element);
    return () => copilotkit.setInterruptElement(null);
  }, [element, config.renderInChat, copilotkit]);

  // Only return element when rendering outside chat
  if (config.renderInChat === false) {
    return element as UseInterruptReturn<TRenderInChat>;
  }

  return undefined as UseInterruptReturn<TRenderInChat>;
}
