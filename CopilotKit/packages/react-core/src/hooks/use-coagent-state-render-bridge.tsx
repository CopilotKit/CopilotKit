import { ReactCustomMessageRendererPosition, useAgent } from "@copilotkitnext/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useCoAgentStateRenders } from "../context";
import { dataToUUID, parseJson } from "@copilotkit/shared";

function getStateWithoutConstantKeys(state: any) {
  const { messages, tools, copilotkit, ...stateWithoutConstantKeys } = state;
  return stateWithoutConstantKeys;
}

// Function that compares states, without the constant keys
function areStatesEquals(a: any, b: any) {
  if ((a && !b) || (!a && b)) return false;
  const { messages, tools, copilotkit, ...aWithoutConstantKeys } = a;
  const {
    messages: bMessages,
    tools: bTools,
    copilotkit: bCopilotkit,
    ...bWithoutConstantKeys
  } = b;

  return JSON.stringify(aWithoutConstantKeys) === JSON.stringify(bWithoutConstantKeys);
}

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

  const getStateRender = useCallback(
    (messageId: string) => {
      return Object.entries(coAgentStateRenders).find(([stateRenderId, stateRender]) => {
        if (claimsRef.current[messageId]) {
          return stateRenderId === claimsRef.current[messageId].stateRenderId;
        }
        const matchingAgentName = stateRender.name === agentId;
        const matchingNodeName = stateRender.nodeName === nodeName;
        return matchingAgentName && (nodeName ? matchingNodeName : true);
      });
    },
    [coAgentStateRenders, nodeName, agentId],
  );

  // Message ID-based claim system - A state render can only be claimed by one message ID
  const handleRenderRequest = ({
    stateRenderId,
    messageId,
    runId,
    stateSnapshot: renderSnapshot,
  }: {
    stateRenderId: string;
    messageId: string;
    runId?: string;
    stateSnapshot?: any;
  }): boolean => {
    // Check if this message has already claimed this state render
    if (claimsRef.current[messageId]) {
      const canRender = claimsRef.current[messageId].stateRenderId === stateRenderId;

      // Update runId if it doesn't exist
      if (
        canRender &&
        runId &&
        (!claimsRef.current[messageId].runId || claimsRef.current[messageId].runId === "pending")
      ) {
        claimsRef.current[messageId].runId = runId;
      }

      return canRender;
    }

    // Do not allow render if any other message has claimed this state render
    const renderClaimedByOtherMessage = Object.values(claimsRef.current).find(
      (c) =>
        c.stateRenderId === stateRenderId &&
        dataToUUID(JSON.stringify(getStateWithoutConstantKeys(c.stateSnapshot))) ===
          dataToUUID(JSON.stringify(getStateWithoutConstantKeys(renderSnapshot))),
    );
    if (renderClaimedByOtherMessage) {
      // If:
      //   - state render already claimed
      //   - snapshot exists in the claiming object and is different from current,
      if (
        renderSnapshot &&
        renderClaimedByOtherMessage.stateSnapshot &&
        !areStatesEquals(renderClaimedByOtherMessage.stateSnapshot, renderSnapshot)
      ) {
        claimsRef.current[messageId] = { stateRenderId, runId };
        return true;
      }
      return false;
    }

    // In this case, we're trying to render a renderer that should already been claimed. It's an edge case, do not allow.
    if (runId !== "pending") return false;

    claimsRef.current[messageId] = { stateRenderId, runId };
    return true;
  };

  return useMemo(() => {
    const [stateRenderId, stateRender] = getStateRender(message.id) ?? [];

    if (!stateRender || !stateRenderId) return null;

    // Is there any state we can use?
    const snapshot = stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : agent?.state;

    // Synchronously check/claim - returns true if this message can render
    const canRender = handleRenderRequest({
      stateRenderId,
      messageId: message.id,
      runId: effectiveRunId,
      stateSnapshot: snapshot,
    });
    if (!canRender) return null;

    // If we found state, and given that now there's a claim for the current message, let's save it in the claim
    if (snapshot && !claimsRef.current[message.id].locked) {
      if (stateSnapshot) {
        claimsRef.current[message.id].stateSnapshot = snapshot;
        claimsRef.current[message.id].locked = true;
      } else {
        claimsRef.current[message.id].stateSnapshot = snapshot;
      }
    }

    if (stateRender.handler) {
      stateRender.handler({
        state: stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : (agent?.state ?? {}),
        nodeName: nodeName ?? "",
      });
    }

    if (stateRender.render) {
      const status = agent?.isRunning ? "inProgress" : "complete";

      if (typeof stateRender.render === "string") return stateRender.render;

      return stateRender.render({
        status,
        // Always use state from claim, to make sure the state does not seem "wiped" for a fraction of a second
        state: claimsRef.current[message.id].stateSnapshot ?? {},
        nodeName: nodeName ?? "",
      });
    }
  }, [
    getStateRender,
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
