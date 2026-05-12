"use client";

/**
 * A2UI Page Component
 *
 * Uses @copilotkit/react-* packages for A2A compatibility.
 * The A2AAgent from @ag-ui/a2a works with the v2 runtime API.
 */

import {
  CopilotKitProvider,
  CopilotChat,
  createA2UIMessageRenderer,
} from "@copilotkit/react-core/v2";
import { a2uiTheme } from "../theme";
import { useState } from "react";

// Create A2UI renderer with custom theme - module level for stable reference
const A2UIRenderer = createA2UIMessageRenderer({ theme: a2uiTheme });
const activityRenderers = [A2UIRenderer];

interface A2UIPageProps {
  children?: React.ReactNode;
}

export function A2UIPage({ children }: A2UIPageProps) {
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const handleNewChat = () => {
    setSessionId(crypto.randomUUID());
  };

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-a2ui"
      showDevConsole={false}
      renderActivityMessages={activityRenderers}
    >
      <div className="immersive-chat-shell">
        {children}
        <button onClick={handleNewChat}>New conversation</button>
        <CopilotChat
          className="immersive-copilot-chat"
          labels={{
            modalHeaderTitle: "A2UI Assistant",
            chatInputPlaceholder:
              "Ask me to generate any UI!",
          }}
          key={sessionId}
        />
      </div>
    </CopilotKitProvider>
  );
}
