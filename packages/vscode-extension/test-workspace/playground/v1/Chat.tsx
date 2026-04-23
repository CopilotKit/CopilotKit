import {
  useCopilotChat,
  useCopilotChatSuggestions,
} from "@copilotkit/react-core";

export function Chat() {
  // V1 data: access the raw chat state (messages, append, reload, etc.)
  useCopilotChat();

  // V1 data: configure dynamic chat suggestions based on context
  useCopilotChatSuggestions({
    instructions:
      "Suggest follow-up questions based on the current page context.",
  });

  return <div>v1 chat</div>;
}
