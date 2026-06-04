"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  CopilotKit,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import { ThreadsDrawer, ThreadsPanelGate } from "@/components/threads-drawer";
import styles from "./showcase-copilotkit.module.css";

type ShowcaseCopilotKitProps = {
  agentId: string;
  children: ReactNode;
  runtimeUrl?: string;
};

export function ShowcaseCopilotKit({
  agentId,
  children,
  runtimeUrl = "/api/copilotkit",
}: ShowcaseCopilotKitProps) {
  const [threadId, setThreadId] = useState<string | undefined>();

  return (
    <CopilotKit
      runtimeUrl={runtimeUrl}
      agent={agentId}
      useSingleEndpoint={false}
    >
      <div className={`${styles.layout} threadsLayout`}>
        <ThreadsPanelGate>
          <ThreadsDrawer
            agentId={agentId}
            threadId={threadId}
            onThreadChange={setThreadId}
          />
        </ThreadsPanelGate>
        <div className={styles.content} key={threadId ?? "new-thread"}>
          <CopilotChatConfigurationProvider
            agentId={agentId}
            hasExplicitThreadId={threadId !== undefined}
            threadId={threadId}
          >
            {children}
          </CopilotChatConfigurationProvider>
        </div>
      </div>
    </CopilotKit>
  );
}
