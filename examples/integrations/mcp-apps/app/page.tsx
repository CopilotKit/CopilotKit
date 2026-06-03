"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { useState } from "react";

import { ThreadsDrawer } from "./components/threads-drawer";
import { ThreadsPanelGate } from "./components/threads-drawer/locked-state";
import styles from "./components/threads-drawer/threads-drawer.module.css";

const agentId = "default";

export default function CopilotKitPage() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <div className={`${styles.layout} threadsLayout`}>
      <ThreadsPanelGate>
        <ThreadsDrawer
          agentId={agentId}
          threadId={threadId}
          onThreadChange={setThreadId}
        />
      </ThreadsPanelGate>
      <div className={styles.mainPanel}>
        <CopilotChatConfigurationProvider agentId={agentId} threadId={threadId}>
          <main className="h-screen w-screen flex justify-center items-center">
            <CopilotChat agentId={agentId} className="w-1/2 h-full" />
          </main>
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}
