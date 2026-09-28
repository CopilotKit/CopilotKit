import type { CopilotChatLabels } from "./types";

export interface CopilotChatConfigurationProviderProps {
  labels?: Partial<CopilotChatLabels>;
  agentId?: string;
  threadId?: string;
  /**
   * Lets internal wrappers (e.g. a v1-style `CopilotKit` bridge that pipes a
   * locally minted UUID through as `threadId`) declare that the supplied
   * `threadId` is NOT a caller choice. When omitted, the provider infers
   * explicitness from whether the `threadId` prop itself was supplied.
   */
  hasExplicitThreadId?: boolean;
  isModalDefaultOpen?: boolean;
  /**
   * @internal Set on the providers `CopilotChat`, `CopilotPopup` and
   * `CopilotSidebar` render themselves: `setActiveThreadId` / `startNewThread`
   * switch the thread of the provider above instead of this one, so a threads
   * drawer inside the chat switches the chat's thread. A provider you nest
   * yourself keeps its own thread.
   */
  forwardThreadSwitching?: boolean;
}
