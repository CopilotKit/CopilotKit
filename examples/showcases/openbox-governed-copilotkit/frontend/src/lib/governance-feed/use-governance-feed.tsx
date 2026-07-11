"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { onOpenBoxSessionHalted } from "@/lib/openbox-halt-state";
import {
  getFeedSnapshot,
  ingestHalt,
  ingestResultsFromMessages,
  ingestTimingFromState,
  resetFeed,
  subscribeToFeed,
} from "./feed-store";
import { buildExecutionTree } from "./tree-builder";
import type { RunNode } from "./types";

const OPENBOX_AGENT_ID = "default";

export interface GovernanceFeedValue {
  runs: RunNode[];
  halted: boolean;
  reset: () => void;
}

export function useGovernanceFeed(): GovernanceFeedValue {
  const { agent } = useAgent({ agentId: OPENBOX_AGENT_ID });

  const snapshot = useSyncExternalStore(
    subscribeToFeed,
    getFeedSnapshot,
    getFeedSnapshot,
  );

  // Ingest current agent snapshot on mount and whenever agent identity changes.
  useEffect(() => {
    ingestResultsFromMessages(
      agent.messages as unknown[],
      agent.state as unknown,
    );
    ingestTimingFromState(agent.state as unknown);

    const subscription = agent.subscribe({
      onMessagesChanged: ({ messages, state }) => {
        ingestResultsFromMessages(messages as unknown[], state as unknown);
      },
      onStateChanged: ({ state }) => {
        ingestResultsFromMessages(
          agent.messages as unknown[],
          state as unknown,
        );
        ingestTimingFromState(state as unknown);
      },
    });
    return () => subscription.unsubscribe();
  }, [agent]);

  // Mirror halt into the store.
  useEffect(() => {
    const off = onOpenBoxSessionHalted(() => ingestHalt());
    return off;
  }, []);

  const reset = useCallback(() => resetFeed(), []);

  const runs = useMemo(
    () => buildExecutionTree(snapshot),
    // snapshot.revision is the change signal from the external store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.revision],
  );

  return { runs, halted: snapshot.halted, reset };
}
