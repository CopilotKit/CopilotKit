import type { CopilotChatLabels } from "./types";

export interface CopilotChatConfigurationProviderProps {
  labels?: Partial<CopilotChatLabels>;
  agentId?: string;
  threadId?: string;
  isModalDefaultOpen?: boolean;
}

