import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/react-core";

// TODO(copilotkit-2.0): `CopilotChatLabels` has more keys in 2.0, so a complete labels object no longer type-checks. Start from `...CopilotChatDefaultLabels` (from "@copilotkit/core") and override only the keys you need: https://docs.copilotkit.ai/migrate/chat-2.0#label-type
export const labels: CopilotChatLabels = {
  chatInputPlaceholder: "Ask me anything...",
  assistantMessageToolbarCopyMessageLabel: "Copy",
};

const checked = /* TODO(copilotkit-2.0): `CopilotChatLabels` has more keys in 2.0, so a complete labels object no longer type-checks. Start from `...CopilotChatDefaultLabels` (from "@copilotkit/core") and override only the keys you need: https://docs.copilotkit.ai/migrate/chat-2.0#label-type */ {
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
