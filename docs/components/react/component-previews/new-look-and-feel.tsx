"use client";

import {
  CopilotSidebar,
  useCopilotChatSuggestions,
} from "@copilotkit/react-ui";
import { CopilotKit } from "@copilotkit/react-core";

export const NewLookAndFeelPreview = () => {
  const apiKey = process.env.NEXT_PUBLIC_COPILOT_CLOUD_PUBLIC_API_KEY;

  // Only render if API key is available
  if (!apiKey) {
    return (
      <div className="p-4 text-sm text-muted-foreground border rounded-lg">
        Preview unavailable: API key not configured
      </div>
    );
  }

  return (
    <CopilotKit publicApiKey={apiKey}>
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  useCopilotChatSuggestions({
    instructions:
      "Give suggestions for a fun conversation to have with the user.",
    minSuggestions: 0,
    maxSuggestions: 3,
  });

  return (
    <CopilotSidebar
      onThumbsUp={(message) => alert(message)}
      onThumbsDown={(message) => alert(message)}
      labels={{
        initial: "Hey there Let's have a fun conversation!",
      }}
    />
  );
};
