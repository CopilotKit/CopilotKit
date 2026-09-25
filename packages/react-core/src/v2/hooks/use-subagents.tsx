import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";

export interface UseSubagentsOptions {
  /** The agent to read. Defaults to the chat's agent. */
  agentId?: string;
  /** The thread to read. Defaults to the chat's thread. */
  threadId?: string;
}

/**
 * Read the AG-UI subagent invocations on an agent thread, live.
 *
 * Each entry has the subagent's `name`, its `status` (`running`, `done`,
 * `suspended` or `error`), and the tool call or parent subagent that started
 * it. The list is in start order and keeps its reference until it changes.
 *
 * The agent must attribute its output to subagents (AG-UI 1.0 subagent
 * events). An agent that does not gives an empty list.
 *
 * @param options - Optional `agentId` and `threadId`; both default to the
 * surrounding chat configuration.
 *
 * @example
 * ```tsx
 * import { useSubagents } from "@copilotkit/react-core/v2";
 *
 * function SubagentProgress() {
 *   const subagents = useSubagents();
 *   return (
 *     <ul>
 *       {subagents.map((subagent) => (
 *         <li key={subagent.subagentRunId}>
 *           {subagent.name}: {subagent.status}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useSubagents({ agentId, threadId }: UseSubagentsOptions = {}) {
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const resolvedAgentId = agentId ?? config?.agentId ?? DEFAULT_AGENT_ID;
  // ponytail: outside a chat, the agent's threadId is read at render time; a
  // later threadId change on the agent alone is picked up on the next render.
  const resolvedThreadId =
    threadId ??
    config?.threadId ??
    copilotkit.getAgent(resolvedAgentId)?.threadId ??
    "";

  const subscribe = useCallback(
    (onChange: () => void) =>
      copilotkit.subscribe({
        onSubagentsChanged: (event) => {
          const isThisThread =
            event.agentId === resolvedAgentId &&
            event.threadId === resolvedThreadId;
          if (isThisThread) onChange();
        },
      }).unsubscribe,
    [copilotkit, resolvedAgentId, resolvedThreadId],
  );
  const read = () => copilotkit.getSubagents(resolvedAgentId, resolvedThreadId);

  return useSyncExternalStore(subscribe, read, read);
}
