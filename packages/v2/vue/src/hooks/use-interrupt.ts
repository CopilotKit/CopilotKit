import {
  computed,
  onScopeDispose,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { useCopilotKit } from "../providers/useCopilotKit";
import { useAgent } from "./use-agent";
import type {
  InterruptEvent,
  InterruptHandlerProps,
  InterruptRenderProps,
} from "../types/interrupt";

export type { InterruptEvent, InterruptHandlerProps, InterruptRenderProps };

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
  resolveInterrupt: (response: unknown) => void;
  slotProps: ComputedRef<
    InterruptRenderProps<TValue, InterruptResult<TValue, TResult>> | null
  >;
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

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useInterrupt<TValue = unknown, TResult = never>(
  config: UseInterruptConfig<TValue, TResult> = {},
): UseInterruptResult<TValue, TResult> {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: config.agentId });
  const interrupt = shallowRef<InterruptEvent<TValue> | null>(null);
  const result = shallowRef<InterruptResult<TValue, TResult>>(null);

  watch(
    agent,
    (resolvedAgent, _previousAgent, onCleanup) => {
      if (!resolvedAgent) {
        interrupt.value = null;
        result.value = null;
        return;
      }

      let localInterrupt: InterruptEvent<TValue> | null = null;
      const subscription = resolvedAgent.subscribe({
        onCustomEvent: ({ event }) => {
          if (event.name === INTERRUPT_EVENT_NAME) {
            localInterrupt = {
              name: event.name,
              value: event.value as TValue,
            };
          }
        },
        onRunStartedEvent: () => {
          localInterrupt = null;
          interrupt.value = null;
        },
        onRunFinalized: () => {
          if (localInterrupt) {
            interrupt.value = localInterrupt;
            localInterrupt = null;
          }
        },
        onRunFailed: () => {
          localInterrupt = null;
        },
      });

      onCleanup(() => subscription.unsubscribe());
    },
    { immediate: true },
  );

  const resolveInterrupt = (response: unknown) => {
    const resolvedAgent = agent.value;
    if (!resolvedAgent) return;

    interrupt.value = null;
    void copilotkit.value.runAgent({
      agent: resolvedAgent,
      forwardedProps: {
        command: {
          resume: response,
        },
      },
    });
  };

  watch(
    interrupt,
    (pendingEvent, _previous, onCleanup) => {
      if (!pendingEvent) {
        result.value = null;
        return;
      }
      if (config.enabled && !config.enabled(pendingEvent)) {
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
        event: pendingEvent,
        resolve: resolveInterrupt,
      });

      if (isPromiseLike(maybePromise)) {
        Promise.resolve(maybePromise)
          .then((resolved) => {
            if (!cancelled) {
              result.value = resolved;
            }
          })
          .catch(() => {
            if (!cancelled) {
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

  const slotProps = computed<
    InterruptRenderProps<TValue, InterruptResult<TValue, TResult>> | null
  >(() => {
    if (!interrupt.value) return null;
    if (config.enabled && !config.enabled(interrupt.value)) return null;

    return {
      event: interrupt.value,
      result: result.value,
      resolve: resolveInterrupt,
    };
  });

  watch(
    [() => copilotkit.value, slotProps, () => config.renderInChat !== false],
    ([core, nextSlotProps, shouldRenderInChat], _previous, onCleanup) => {
      if (!shouldRenderInChat) {
        return;
      }

      core.setInterruptState(nextSlotProps as InterruptRenderProps<any, any> | null);
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
    if (config.renderInChat !== false && core.interruptState === slotProps.value) {
      core.setInterruptState(null);
    }
  });

  return {
    interrupt: interrupt as Ref<InterruptEvent<TValue> | null>,
    result: result as Ref<InterruptResult<TValue, TResult>>,
    hasInterrupt: computed(() => slotProps.value !== null),
    resolveInterrupt,
    slotProps: slotProps as ComputedRef<
      InterruptRenderProps<TValue, InterruptResult<TValue, TResult>> | null
    >,
  };
}
