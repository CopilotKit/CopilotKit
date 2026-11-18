"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core";
import { useState } from "react";
import { a2uiV08Renderer } from "./components/a2ui-v0-8-renderer";
import { ThreadsDrawer } from "./components/threads-drawer";
import { ThreadsPanelGate } from "./components/threads-drawer/locked-state";
import styles from "./components/threads-drawer/threads-drawer.module.css";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

// The A2A agent sends A2UI v0.8, which CopilotKit's generative UI does not
// render. This app-owned renderer draws its `a2ui-surface` activities.
const activityRenderers = [a2uiV08Renderer];

export default function Home() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      renderActivityMessages={activityRenderers}
    >
      <div className={`${styles.layout} threadsLayout`}>
        <ThreadsPanelGate>
          <ThreadsDrawer
            agentId="default"
            threadId={threadId}
            onThreadChange={setThreadId}
          />
        </ThreadsPanelGate>
        <div className={styles.mainPanel}>
          <CopilotChatConfigurationProvider
            agentId="default"
            threadId={threadId}
          >
            <main
              className="h-full overflow-auto w-screen"
              style={{ minHeight: "100dvh" }}
            >
              <CopilotChat agentId="default" className="h-full" />
            </main>
          </CopilotChatConfigurationProvider>
        </div>
      </div>
    </CopilotKitProvider>
  );
}
