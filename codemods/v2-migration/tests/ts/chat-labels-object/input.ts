import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/react-core/v2";

export const labels: CopilotChatLabels = {
  chatInputPlaceholder: "Ask me anything...",
  assistantMessageToolbarCopyMessageLabel: "Copy",
};

const checked = {
  chatInputPlaceholder: "Type here",
} satisfies CopilotChatLabels;

// Spreads the defaults, so it already has every key.
const spread: CopilotChatLabels = {
  ...CopilotChatDefaultLabels,
  chatInputPlaceholder: "Ask me anything...",
};

// A partial override never needs every key.
const partial: Partial<CopilotChatLabels> = {
  chatInputPlaceholder: "Ask me anything...",
};

export { checked, spread, partial };
