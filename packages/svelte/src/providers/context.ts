import type { CopilotKitCoreSvelte } from "../lib/svelte-core";

export interface CopilotKitContextValue {
  copilotkit: CopilotKitCoreSvelte;
  executingToolCallIds: Set<string>;
}

export const COPILOT_KIT_KEY = Symbol("copilotkit");
export const COPILOT_CHAT_CONFIG_KEY = Symbol("copilotChatConfig");
