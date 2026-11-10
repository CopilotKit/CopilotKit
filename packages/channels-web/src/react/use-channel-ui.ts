import { useEffect, useState } from "react";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import {
  CHANNEL_INTERACTION_KEY,
  CHANNELS_UI_DELETE_EVENT,
  CHANNELS_UI_EVENT,
} from "../wire.js";
import type { ChannelInteraction, WebUiNode } from "../wire.js";

/** UI per message id. */
export type ChannelUiMap = ReadonlyMap<string, readonly WebUiNode[]>;

function messageIdOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const id = (value as { messageId?: unknown }).messageId;
  return typeof id === "string" ? id : undefined;
}

/**
 * Keep the latest UI for each message of an AG-UI agent.
 *
 * It listens for `channels.ui` events (set or replace the UI of a message)
 * and `channels.ui.delete` events (remove it). Look up a message's UI with
 * `map.get(message.id)`; the id matches the assistant text message that
 * carries the fallback text.
 *
 * The map lives in memory and starts empty for each agent instance.
 */
export function useChannelUi(agent: AbstractAgent | undefined): ChannelUiMap {
  const [ui, setUi] = useState<ChannelUiMap>(() => new Map());

  useEffect(() => {
    setUi(new Map());
    if (!agent) return;
    const { unsubscribe } = agent.subscribe({
      onCustomEvent({ event }) {
        if (event.name === CHANNELS_UI_EVENT) {
          const messageId = messageIdOf(event.value);
          const ir = (event.value as { ir?: unknown }).ir;
          if (!messageId || !Array.isArray(ir)) return;
          setUi((prev) => new Map(prev).set(messageId, ir as WebUiNode[]));
        } else if (event.name === CHANNELS_UI_DELETE_EVENT) {
          const messageId = messageIdOf(event.value);
          if (!messageId) return;
          setUi((prev) => {
            if (!prev.has(messageId)) return prev;
            const next = new Map(prev);
            next.delete(messageId);
            return next;
          });
        }
      },
    });
    return unsubscribe;
  }, [agent]);

  return ui;
}

/**
 * Send a control click to the Channel. It starts a new run on the agent with
 * `forwardedProps.channelInteraction`; the response streams whatever the
 * click handler sends back.
 */
export function sendChannelInteraction(
  agent: AbstractAgent,
  interaction: ChannelInteraction,
): Promise<RunAgentResult> {
  return agent.runAgent({
    forwardedProps: { [CHANNEL_INTERACTION_KEY]: interaction },
  });
}
