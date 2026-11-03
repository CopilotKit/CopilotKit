import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { Interrupt } from "@ag-ui/client";
import { ɵInterruptController } from "@copilotkit/core";
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

  const controller = new ɵInterruptController<
    TValue,
    InterruptResult<TValue, TResult>
  >(
    { runAgent: (params) => copilotkit.value.runAgent(params) },
    {
      enabled: (event) => config.enabled?.(event) ?? true,
      handler: (props) =>
        config.handler
          ? (config.handler(props) as InterruptResult<TValue, TResult>)
          : null,
    },
  );
  const snapshot = shallowRef(controller.getSnapshot());
  controller.subscribe(() => {
    snapshot.value = controller.getSnapshot();
  });

  watch(
    agent,
    (resolvedAgent) => {
      if (resolvedAgent) controller.connect(resolvedAgent);
      else controller.disconnect();
    },
    { immediate: true },
  );

  const { resolve, cancel } = controller;
  const slotProps = computed(() => snapshot.value.renderProps);

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

  onScopeDispose(() => controller.dispose());

  return {
    interrupt: computed(() => slotProps.value?.event ?? null),
    result: computed(() => snapshot.value.result) as Ref<
      InterruptResult<TValue, TResult>
    >,
    hasInterrupt: computed(() => slotProps.value !== null),
    resolve,
    // Aliases kept for back-compat.
    resolveInterrupt: resolve,
    cancel,
    cancelInterrupt: cancel,
    slotProps: slotProps as ComputedRef<InterruptRenderProps<
      TValue,
      InterruptResult<TValue, TResult>
    > | null>,
  };
}
