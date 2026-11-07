/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useCoAgentStateRender:
 *   V2 import and usage:
 *     import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
 *
 *     function AgentStateView() {
 *       const { agent } = useAgent({
 *         agentId: "basic_agent",
 *         updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
 *       });
 *       const state = agent.state;
 *
 *       return (
 *         <YourComponent
 *           agentStateProperty={state.agent_state_property}
 *           isRunning={agent.isRunning}
 *         />
 *       );
 *     }
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-agent.tsx
 *   V2 docs: https://docs.copilotkit.ai/generative-ui/state-rendering
 *   Migration note: Use useAgent to subscribe to agent state and run-status changes, then render agent.state directly.
 *   Migration note: V2 uses ordinary React rendering instead of registering a chat-specific state renderer.
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * <Callout type="info">
 *   In v2, read `agent.state` from [`useAgent`](/reference/v2/hooks/useAgent) and render it. See [State rendering](/generative-ui/state-rendering).
 * </Callout>
 *
 * The hook renders UI or text in the chat from the state of an agent. Use it to show
 * intermediate state or progress while the agent runs.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * ```tsx
 * import { useCoAgentStateRender } from "@copilotkit/react-core";
 *
 * type YourAgentState = {
 *   agent_state_property: string;
 * }
 *
 * useCoAgentStateRender<YourAgentState>({
 *   name: "basic_agent",
 *   nodeName: "optionally_specify_a_specific_node",
 *   render: ({ status, state, nodeName }) => {
 *     return (
 *       <YourComponent
 *         agentStateProperty={state.agent_state_property}
 *         status={status}
 *         nodeName={nodeName}
 *       />
 *     );
 *   },
 * });
 * ```
 *
 * This allows for you to render UI components or text based on what is happening within the agent.
 *
 * To build a full example, see the [state rendering guide](/generative-ui/state-rendering).
 */

import { useRef, useContext, useEffect } from "react";
import { CopilotContext } from "../context/copilot-context";
import { randomId, CopilotKitAgentDiscoveryError } from "@copilotkit/shared";
import type { CoAgentStateRender } from "../types/coagent-action";
import { useToast } from "../components/toast/toast-provider";
import { useCoAgentStateRenders } from "../context/coagent-state-renders-context";

/**
 * This hook is used to render agent state with custom UI components or text. This is particularly
 * useful for showing intermediate state or progress during Agentic Copilot operations.
 * To get started using rendering intermediate state through this hook, checkout the documentation.
 *
 * https://docs.copilotkit.ai/langgraph-python/shared-state/predictive-state-updates
 */

// We implement useCoAgentStateRender dependency handling so that
// the developer has the option to not provide any dependencies.
// see useCopilotAction for more details about this approach.
export function useCoAgentStateRender<T = any>(
  action: CoAgentStateRender<T>,
  /** Values that re-register the render when they change. */
  dependencies?: any[],
): void {
  const { chatComponentsCache, availableAgents } = useContext(CopilotContext);
  const {
    setCoAgentStateRender,
    removeCoAgentStateRender,
    coAgentStateRenders,
  } = useCoAgentStateRenders();
  const idRef = useRef<string>(randomId());
  const { setBannerError, addToast } = useToast();

  useEffect(() => {
    if (
      availableAgents?.length &&
      !availableAgents.some((a) => a.name === action.name)
    ) {
      const message = `(useCoAgentStateRender): Agent "${action.name}" not found. Make sure the agent exists and is properly configured.`;

      // Route to banner instead of toast for consistency
      const agentError = new CopilotKitAgentDiscoveryError({
        agentName: action.name,
        availableAgents: availableAgents.map((a) => ({
          name: a.name,
          id: a.id,
        })),
      });
      setBannerError(agentError);
    }
  }, [availableAgents]);

  const key = `${action.name}-${action.nodeName || "global"}`;

  if (dependencies === undefined) {
    if (coAgentStateRenders[idRef.current]) {
      coAgentStateRenders[idRef.current].handler = action.handler as any;
      if (typeof action.render === "function") {
        if (chatComponentsCache.current !== null) {
          chatComponentsCache.current.coAgentStateRenders[key] = action.render;
        }
      }
    }
  }

  useEffect(() => {
    // Check for duplicates by comparing against all other actions
    const currentId = idRef.current;
    const hasDuplicate = Object.entries(coAgentStateRenders).some(
      ([id, otherAction]) => {
        // Skip comparing with self
        if (id === currentId) return false;

        // Different agent names are never duplicates
        if (otherAction.name !== action.name) return false;

        // Same agent names:
        const hasNodeName = !!action.nodeName;
        const hasOtherNodeName = !!otherAction.nodeName;

        // If neither has nodeName, they're duplicates
        if (!hasNodeName && !hasOtherNodeName) return true;

        // If one has nodeName and other doesn't, they're not duplicates
        if (hasNodeName !== hasOtherNodeName) return false;

        // If both have nodeName, they're duplicates only if the names match
        return action.nodeName === otherAction.nodeName;
      },
    );

    if (hasDuplicate) {
      const message = action.nodeName
        ? `Found multiple state renders for agent ${action.name} and node ${action.nodeName}. State renders might get overridden`
        : `Found multiple state renders for agent ${action.name}. State renders might get overridden`;

      addToast({
        type: "warning",
        message,
        id: `dup-action-${action.name}`,
      });
    }
  }, [coAgentStateRenders]);

  useEffect(() => {
    setCoAgentStateRender(idRef.current, action as any);
    if (chatComponentsCache.current !== null && action.render !== undefined) {
      chatComponentsCache.current.coAgentStateRenders[key] = action.render;
    }
    return () => {
      removeCoAgentStateRender(idRef.current);
    };
  }, [
    setCoAgentStateRender,
    removeCoAgentStateRender,
    action.name,
    // include render only if it's a string
    typeof action.render === "string" ? action.render : undefined,
    // dependencies set by the developer
    ...(dependencies || []),
  ]);
}
