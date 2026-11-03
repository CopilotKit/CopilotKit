import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Interrupt } from "@ag-ui/client";
import { ɵInterruptController } from "@copilotkit/core";
import { useCopilotKit } from "../context";
import { useAgent } from "./use-agent";
import type {
  InterruptEvent,
  InterruptRenderProps,
  InterruptHandlerProps,
} from "../types/interrupt";

export type {
  InterruptEvent,
  InterruptRenderProps,
  InterruptHandlerProps,
  Interrupt,
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

type InterruptRenderInChat = boolean | undefined;

type UseInterruptReturn<TRenderInChat extends InterruptRenderInChat> =
  TRenderInChat extends false
    ? React.ReactElement | null
    : TRenderInChat extends true | undefined
      ? void
      : React.ReactElement | null | void;

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
  const { agent } = useAgent({ agentId: config.agentId, updates: [] });

  // Read consumer callbacks through refs so inline lambdas neither recreate
  // the controller nor churn the element memo.
  const renderRef = useRef(config.render);
  renderRef.current = config.render;
  const enabledRef = useRef(config.enabled);
  enabledRef.current = config.enabled;
  const handlerRef = useRef(config.handler);
  handlerRef.current = config.handler;
  const copilotkitRef = useRef(copilotkit);
  copilotkitRef.current = copilotkit;

  const [controller] = useState(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new ɵInterruptController<any, TResult>(
        { runAgent: (params) => copilotkitRef.current.runAgent(params) },
        {
          enabled: (event) => enabledRef.current?.(event) ?? true,
          handler: (props) =>
            handlerRef.current ? handlerRef.current(props) : (null as TResult),
        },
      ),
  );

  useEffect(() => {
    controller.connect(agent);
    return () => controller.disconnect();
  }, [controller, agent]);

  const { renderProps } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const element = useMemo(
    () =>
      renderProps
        ? renderRef.current(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderProps as InterruptRenderProps<
              any,
              InterruptResult<any, TResult>
            >,
          )
        : null,
    [renderProps],
  );

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
