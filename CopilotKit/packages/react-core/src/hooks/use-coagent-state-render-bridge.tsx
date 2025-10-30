import { ReactCustomMessageRendererPosition, useAgent } from "@copilotkitnext/react";
import { useEffect, useMemo, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useCoAgentStateRenders } from "../context";
import { parseJson } from "@copilotkit/shared";

/**
 * Bridge hook that connects agent state renders to chat messages.
 *
 * ## Purpose
 * This hook finds matching state render configurations (registered via useCoAgentStateRender)
 * and returns UI to render in chat.
 * It ensures each state render appears exactly once per run, bound to a specific message.
 *
 * ## Message-Binding System
 *
 * ### The Problem
 * Multiple bridge component instances render simultaneously (one per message). Without coordination,
 * they would all try to render the same state render, causing duplicates.
 *
 * ### The Solution: Message Claiming
 * Each state render is "claimed" by exactly one message ID per run:
 *
 * 1. **First render**: Bridge checks if state render is already claimed for this run
 * 2. **If unclaimed**: Claims it synchronously (via ref) for this message ID
 * 3. **If claimed**: Only renders if the message ID matches the claim
 * 4. **Result**: Only one bridge instance (the claiming message) renders each state render
 *
 * ### Pending RunId Migration
 *
 * **Challenge**: `runId` is initially undefined when messages first render, then appears later.
 *
 * **Solution**: Use "pending" as a temporary runId:
 *
 * 1. **No runId yet**: Use `"pending"` as the effectiveRunId
 * 2. **Claim under "pending"**: First message claims the state render under runId="pending"
 * 3. **RunId appears**: When real runId arrives, migrate all "pending" claims to the real runId
 * 4. **Migration**: `migrateRunId("pending", actualRunId)` atomically transfers all claims
 * 5. **After migration**: All subsequent messages see the real runId with existing claims
 *
 * ### Synchronous Claiming (Ref-based)
 *
 * Claims are stored in a ref (not React state) for synchronous checking:
 * - Multiple bridges render in the same tick
 * - State updates are async - would allow duplicates before update completes
 * - Ref provides immediate, synchronous claim checking
 * - State is synced after render for debugging visibility only
 *
 * ## Flow Example
 *
 * ```
 * Time 1: Message A renders, runId=undefined
 *   → effectiveRunId = "pending"
 *   → Claims state render under "pending" for message A
 *   → Renders UI
 *
 * Time 2: Message B renders, runId=undefined
 *   → effectiveRunId = "pending"
 *   → Checks claim: Already claimed by message A
 *   → Returns null (doesn't render)
 *
 * Time 3: Real runId appears (e.g., "run-123")
 *   → Migration effect triggers
 *   → Migrates "pending" → "run-123"
 *   → Message A continues rendering under "run-123"
 *
 * Time 4: New run starts with runId="run-456"
 *   → No claims exist for "run-456"
 *   → First message claims and renders
 * ```
 */
export function useCoagentStateRenderBridge(
  agentId: string,
  props: {
    message: any;
    position: ReactCustomMessageRendererPosition;
    runId: string;
    messageIndex: number;
    messageIndexInRun: number;
    numberOfMessagesInRun: number;
    agentId: string;
    stateSnapshot: any;
  },
) {
  const { stateSnapshot, messageIndexInRun, message } = props;
  const { coAgentStateRenders, claimsRef } = useCoAgentStateRenders();
  const { agent } = useAgent({ agentId });
  const [nodeName, setNodeName] = useState<string | undefined>(undefined);

  const runId = props.runId ?? message.runId;
  const effectiveRunId = runId || "pending";

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onStepStartedEvent: ({ event }) => {
        if (event.stepName !== nodeName) {
          setNodeName(event.stepName);
        }
      },
      onStepFinishedEvent: ({ event }) => {
        if (event.stepName === nodeName) {
          setNodeName(undefined);
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, nodeName]);

  if (messageIndexInRun !== 0) {
    return null;
  }

  const foundRender = useMemo(() => {
    return Object.entries(coAgentStateRenders).find(([_, stateRender]) => {
      const matchingAgentName = stateRender.name === agentId;
      const matchingNodeName = stateRender.nodeName === nodeName;
      return matchingAgentName && (nodeName ? matchingNodeName : true);
    });
  }, [coAgentStateRenders, nodeName, agentId]);

  const handleRenderRequest = ({
    runId,
    stateRenderId,
    messageId,
  }: {
    runId: string;
    stateRenderId: string;
    messageId: string;
  }): boolean => {
    // If we know this runId, we check if the current state render action is the right one for it.
    if (claimsRef.current[runId]) {
      return (
        claimsRef.current[runId].stateRenderId === stateRenderId &&
        claimsRef.current[runId].messageId === messageId
      );
    }
    if (claimsRef.current["pending"] && runId !== "pending") {
      claimsRef.current[runId] = claimsRef.current["pending"];
      delete claimsRef.current["pending"];
      return handleRenderRequest({ runId, stateRenderId, messageId });
    }
    // If we don't know this runId
    if (!claimsRef.current[runId]) {
      // Does any other runId claimed this state render?
      const claimedStateRender = Object.values(claimsRef.current).find((claim) => {
        return claim.stateRenderId === stateRenderId;
      });
      // if a claimer is found
      if (claimedStateRender) {
        // If for some reason, the same message id exist in the newer runId, we also create a claim for the new runId
        if (claimedStateRender.messageId === messageId) {
          claimsRef.current[runId] = claimedStateRender;
          return true;
        }

        // Otherwise, we don't allow to render
        return false;
      }

      // If not, we claim this state render for the current runId
      claimsRef.current = {
        ...claimsRef.current,
        [runId]: {
          stateRenderId,
          messageId,
        },
      };
      return true;
    }

    return true;
  };

  return useMemo(() => {
    const [stateRenderId, stateRender] = foundRender ?? [];

    if (!stateRender || !stateRenderId || messageIndexInRun !== 0) return null;

    // Synchronously check/claim - returns true if this message can render
    const canRender = handleRenderRequest({
      runId: effectiveRunId,
      stateRenderId,
      messageId: message.id,
    });
    if (!canRender) return null;

    if (stateRender.handler) {
      stateRender.handler({
        state: stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : (agent?.state ?? {}),
        nodeName: nodeName ?? "",
      });
    }

    if (stateRender.render) {
      const status = agent?.isRunning ? "inProgress" : "complete";

      if (typeof stateRender.render === "string") return stateRender.render;

      // console.log('rendering2')
      return stateRender.render({
        status,
        state: stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : (agent?.state ?? {}),
        nodeName: nodeName ?? "",
      });
    }
  }, [
    foundRender,
    stateSnapshot,
    agent?.state,
    agent?.isRunning,
    nodeName,
    effectiveRunId,
    message.id,
  ]);
}

export function CoAgentStateRenderBridge(props: {
  message: any;
  position: ReactCustomMessageRendererPosition;
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: any;
}) {
  return useCoagentStateRenderBridge(props.agentId, props);
}
