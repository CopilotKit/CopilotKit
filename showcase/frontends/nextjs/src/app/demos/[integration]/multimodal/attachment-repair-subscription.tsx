"use client";

import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { attachmentRepair } from "./attachment-repair";

/**
 * Subscribes the attachment repairs to the agent that the chat uses. It
 * renders nothing, so the agent's updates re-render only this component.
 * `useAgent` hands out a stand-in agent until runtime discovery ends, so the
 * effect subscribes again when the agent changes.
 */
export function AttachmentRepairSubscription({ agentId }: { agentId: string }) {
  const { agent } = useAgent({ agentId });

  useEffect(() => {
    const subscription = agent.subscribe(attachmentRepair);
    return () => subscription.unsubscribe();
  }, [agent]);

  return null;
}
