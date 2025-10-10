"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useState } from "react";
import { MainContent } from "@/components/MainContent";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/guides/frontend-actions
  useCopilotAction({
    name: "setThemeColor",
    parameters: [{
      name: "themeColor",
      description: "The theme color to set. Make sure to pick nice colors.",
      required: true,
    }],
    handler({ themeColor }) {
      setThemeColor(themeColor);
    },
  });

  return (
    <CopilotKit
      agent="sample_agent"
      runtimeUrl="/api/copilotkit"
      showDevConsole={true}
      threadId={threadId}
    >
      <main style={{ "--copilot-kit-primary-color": themeColor } as CopilotKitCSSProperties}>
        <MainContent
          themeColor={themeColor}
          threadId={threadId}
          onThreadChange={setThreadId}
        />
        <CopilotSidebar
          clickOutsideToClose={false}
          defaultOpen={true}
          labels={{
            title: "Popup Assistant",
            initial: "👋 Hi! Test thread switching with the top-left button.\n\nTry:\n- **Create threads**: Click 'New' to create a thread\n- **Switch threads**: Expand the list (▶) and click any thread\n- **Verify fix**: Messages stay in the correct thread\n\nYou can also try:\n- **Frontend Tools**: \"Set the theme to orange\"\n- **Shared State**: \"Write a proverb about AI\"\n- **Generative UI**: \"Get the weather in SF\""
          }}
        />
      </main>
    </CopilotKit>
  );
}

