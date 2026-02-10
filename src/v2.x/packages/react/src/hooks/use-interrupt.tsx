import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useAgent } from "./use-agent";
import type { InterruptEvent, InterruptRenderProps, InterruptHandlerProps } from "../types/interrupt";

export type { InterruptEvent, InterruptRenderProps, InterruptHandlerProps };

const INTERRUPT_EVENT_NAME = "on_interrupt";

export interface UseInterruptConfig<TValue = unknown> {
  render: (props: InterruptRenderProps<TValue>) => React.ReactElement;
  handler?: (props: InterruptHandlerProps<TValue>) => unknown | Promise<unknown>;
  enabled?: (event: InterruptEvent<TValue>) => boolean;
  agentId?: string;
  /** When true (default), the interrupt UI renders inside `<CopilotChat>` automatically. Set to false to render it yourself. */
  renderInChat?: boolean;
}

export function useInterrupt<TValue = unknown>(
  config: UseInterruptConfig<TValue>,
): React.ReactElement | null {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: config.agentId });
  const [pendingEvent, setPendingEvent] = useState<InterruptEvent<TValue> | null>(null);

  useEffect(() => {
    let localInterrupt: InterruptEvent<TValue> | null = null;

    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          localInterrupt = { name: event.name, value: event.value };
        }
      },
      onRunStartedEvent: () => {
        localInterrupt = null;
      },
      onRunFinalized: () => {
        if (localInterrupt) {
          setPendingEvent(localInterrupt);
          localInterrupt = null;
        }
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

  const element = useMemo(() => {
    if (!pendingEvent) return null;
    if (config.enabled && !config.enabled(pendingEvent)) return null;

    let result: unknown = null;
    if (config.handler) {
      result = config.handler({ event: pendingEvent, resolve });
    }

    return config.render({ event: pendingEvent, result, resolve });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEvent, config.enabled, config.handler, config.render, resolve]);

  // Publish to core for in-chat rendering
  useEffect(() => {
    if (config.renderInChat === false) return;
    copilotkit.setInterruptElement(element);
    return () => copilotkit.setInterruptElement(null);
  }, [element, config.renderInChat, copilotkit]);

  // Only return element when rendering outside chat
  return config.renderInChat === false ? element : null;
}
