import { ReactCustomMessageRendererPosition, useAgent } from "@copilotkitnext/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useCoAgentStateRenders } from "../context";
import { dataToUUID, parseJson } from "@copilotkit/shared";

function getStateWithoutConstantKeys(state: any) {
  if (!state) return {};
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
 * It ensures each state render appears bound to a specific message, preventing duplicates while
 * allowing re-binding when the underlying state changes significantly.
 *
 * ## Message-ID-Based Claiming System
 *
 * ### The Problem
 * Multiple bridge component instances render simultaneously (one per message). Without coordination,
 * they would all try to render the same state render, causing duplicates.
 *
 * ### The Solution: Message-ID Claims with State Comparison
 * Each state render is "claimed" by exactly one **message ID** (not runId):
 *
 * **Claim Structure**: `claimsRef.current[messageId] = { stateRenderId, runId, stateSnapshot, locked }`
 *
 * **Primary binding is by messageId because**:
 * - runId is not always available immediately (starts as "pending")
 * - messageId is the stable identifier throughout the message lifecycle
 * - Claims persist across component remounts via context ref
 *
 * ### Claiming Logic Flow
 *
 * 1. **Message already has a claim**:
 *    - Check if the claim matches the current stateRenderId
 *    - If yes → render (this message owns this render)
 *    - Update runId if it was "pending" and now available
 *
 * 2. **State render claimed by another message**:
 *    - Compare state snapshots (ignoring constant keys: messages, tools, copilotkit)
 *    - If states are identical → block rendering (duplicate)
 *    - **If states are different → allow claiming** (new data, new message)
 *    - This handles cases where the same render type shows different states in different messages
 *
 * 3. **Unclaimed state render**:
 *    - Only allow claiming if runId is "pending" (initial render)
 *    - If runId is real but no claim exists → block (edge case protection)
 *    - Create new claim: `claimsRef.current[messageId] = { stateRenderId, runId }`
 *
 * ### State Snapshot Locking
 *
 * Once a state snapshot is captured and locked for a message:
 * - The UI always renders with the locked snapshot (not live agent.state)
 * - Prevents UI from appearing "wiped" during state transitions
 * - Locked when: stateSnapshot prop is available (from message persistence)
 * - Unlocked state: can still update from live agent.state
 *
 * ### Synchronous Claiming (Ref-based)
 *
 * Claims are stored in a context-level ref (not React state):
 * - Multiple bridges render in the same tick
 * - State updates are async - would allow duplicates before update completes
 * - Ref provides immediate, synchronous claim checking
 * - Survives component remounts (stored in context, not component)
 *
 * ## Flow Example
 *
 * ```
 * Time 1: Message A renders, runId=undefined, state={progress: 50%}
 *   → effectiveRunId = "pending"
 *   → Claims: claimsRef["msgA"] = { stateRenderId: "tasks", runId: "pending", stateSnapshot: {progress: 50%} }
 *   → Renders UI with 50% progress
 *
 * Time 2: Message B renders, runId=undefined, same state
 *   → Checks: "tasks" already claimed by msgA with same state
 *   → Returns null (blocked - duplicate)
 *
 * Time 3: Real runId appears (e.g., "run-123")
 *   → Updates claim: claimsRef["msgA"].runId = "run-123"
 *   → Message A continues rendering
 *
 * Time 4: Agent processes more, state={progress: 100%}
 *   → Message A: locked to 50% (stateSnapshot locked)
 *   → Message C renders with state={progress: 100%}
 *   → Checks: "tasks" claimed by msgA but state is DIFFERENT (50% vs 100%)
 *   → Allows new claim: claimsRef["msgC"] = { stateRenderId: "tasks", runId: "run-123", stateSnapshot: {progress: 100%} }
 *   → Both messages render independently with their own snapshots
 * ```
 */
export interface CoAgentStateRenderBridgeProps {
  message: any;
  position: ReactCustomMessageRendererPosition;
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: any;
}

export function useCoagentStateRenderBridge(agentId: string, props: CoAgentStateRenderBridgeProps) {
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

  const getStateRender = useCallback(
    (messageId: string) => {
      return Object.entries(coAgentStateRenders).find(([stateRenderId, stateRender]) => {
        if (claimsRef.current[messageId]) {
          return stateRenderId === claimsRef.current[messageId].stateRenderId;
        }
        const matchingAgentName = stateRender.name === agentId;
        const matchesNodeContext = stateRender.nodeName ? stateRender.nodeName === nodeName : true;
        return matchingAgentName && matchesNodeContext;
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

    // No existing claim anywhere yet – allow this message to claim even if we already know the runId.
    if (!runId) {
      return false;
    }

    claimsRef.current[messageId] = { stateRenderId, runId };
    return true;
  };

  return useMemo(() => {
    if (messageIndexInRun !== 0) {
      return null;
    }

    const [stateRenderId, stateRender] = getStateRender(message.id) ?? [];

    if (!stateRender || !stateRenderId) {
      return null;
    }

    // Is there any state we can use?
    const snapshot = stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : agent?.state;

    // Synchronously check/claim - returns true if this message can render
    const canRender = handleRenderRequest({
      stateRenderId,
      messageId: message.id,
      runId: effectiveRunId,
      stateSnapshot: snapshot,
    });
    if (!canRender) {
      return null;
    }

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
    messageIndexInRun,
  ]);
}

export function CoAgentStateRenderBridge(props: CoAgentStateRenderBridgeProps) {
  return useCoagentStateRenderBridge(props.agentId, props);
}
