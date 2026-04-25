"use client";

/**
 * Hook stub — exposes a "rendered messages" convenience if the demo ever
 * grows to need per-message composition (activity renderers, custom messages,
 * etc.). Kept minimal for parity with the canonical shape.
 */

import { useAgent } from "@copilotkit/react-core/v2";

export function useRenderedMessages(agentId: string) {
  const { agent } = useAgent({ agentId });
  return agent.messages;
}
