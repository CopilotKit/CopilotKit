import { ReactCustomMessageRendererPosition, useAgent } from "@copilotkitnext/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useCoAgentStateRenders } from "../context";
import { parseJson } from "@copilotkit/shared";
import { RenderStatus } from "./use-coagent-state-render-bridge.helpers";
import { useStateRenderRegistry } from "./use-coagent-state-render-registry";

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
  const { stateSnapshot, message } = props;
  const { coAgentStateRenders, claimsRef } = useCoAgentStateRenders();
  const { agent } = useAgent({ agentId });
  const [nodeName, setNodeName] = useState<string | undefined>(undefined);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onStateChanged: () => {
        forceUpdate((value) => value + 1);
      },
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
  const stateRenderEntry = useMemo(() => getStateRender(message.id), [getStateRender, message.id]);
  const stateRenderId = stateRenderEntry?.[0];
  const stateRender = stateRenderEntry?.[1];

  const registryMessage = {
    ...message,
    runId: props.runId ?? message.runId,
  };
  const { canRender } = useStateRenderRegistry({
    agentId,
    stateRenderId,
    message: registryMessage,
    messageIndex: props.messageIndex,
    stateSnapshot,
    agentState: agent?.state,
    agentMessages: agent?.messages,
    claimsRef,
  });

  return useMemo(() => {
    if (!stateRender || !stateRenderId) {
      return null;
    }
    if (!canRender) {
      return null;
    }

    if (stateRender.handler) {
      stateRender.handler({
        state: stateSnapshot ? parseJson(stateSnapshot, stateSnapshot) : (agent?.state ?? {}),
        nodeName: nodeName ?? "",
      });
    }

    if (stateRender.render) {
      const status = agent?.isRunning ? RenderStatus.InProgress : RenderStatus.Complete;

      if (typeof stateRender.render === "string") return stateRender.render;

      return stateRender.render({
        status,
        // Always use state from claim, to make sure the state does not seem "wiped" for a fraction of a second
        state: claimsRef.current[message.id].stateSnapshot ?? {},
        nodeName: nodeName ?? "",
      });
    }
  }, [
    stateRender,
    stateRenderId,
    agent?.state,
    agent?.isRunning,
    nodeName,
    message.id,
    stateSnapshot,
    canRender,
  ]);
}

export function CoAgentStateRenderBridge(props: CoAgentStateRenderBridgeProps) {
  return useCoagentStateRenderBridge(props.agentId, props);
}
