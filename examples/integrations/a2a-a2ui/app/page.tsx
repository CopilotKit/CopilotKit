"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { useState } from "react";
import { a2uiV08Renderer } from "./components/a2ui-v0-8-renderer";
import { ThreadsDrawer } from "./components/threads-drawer";
import { ThreadsPanelGate } from "./components/threads-drawer/locked-state";
import styles from "./components/threads-drawer/threads-drawer.module.css";
import { theme } from "./theme";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

const activityRenderers = [a2uiV08Renderer];

export default function Home() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole="auto"
      useSingleEndpoint={false}
      a2ui={{ theme }}
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
