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
}
