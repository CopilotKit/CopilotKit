"use client";

import { useEffect } from "react";
// `@ag-ui/*` isn't a direct dep of this demo; react-core/v2 re-exports the
// client types (`export * from "@ag-ui/client"`), so `BaseEvent` comes from there.
import { useAgent, type BaseEvent } from "@copilotkit/react-core/v2";
import { eventToCard } from "@/lib/inspector/event-cards";
import { useInspector } from "@/lib/inspector/store";

/**
 * Bridges the raw AG-UI event stream into the inspector store. Mount once
 * inside both the CopilotKit provider and the InspectorStoreProvider.
 *
 * Ported from splat-demo (Intelligence #361); the governance_decision handling
 * was dropped — banking has no server-side component governance.
 */
export function useInspectorEvents(): void {
  const { agent } = useAgent();
  const { pushCard } = useInspector();

  useEffect(() => {
    const sub = agent.subscribe({
      onEvent({ event }: { event: BaseEvent }) {
        const card = eventToCard(event);
        if (card) pushCard(card);
      },
    });
    return () => sub.unsubscribe();
  }, [agent, pushCard]);
}
