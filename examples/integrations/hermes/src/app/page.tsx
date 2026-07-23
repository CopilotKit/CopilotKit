"use client";

import { useState } from "react";

import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";
import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";

import styles from "@/components/threads-drawer/threads-drawer.module.css";

export default function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <div className={styles.layout}>
      <ThreadsPanelGate>
        <ThreadsDrawer
          agentId="default"
          threadId={threadId}
          onThreadChange={setThreadId}
        />
      </ThreadsPanelGate>
      <div className={styles.mainPanel}>
        {/* One provider so the chat and any per-thread state share a threadId. */}
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <div className="h-full flex flex-col pb-6 dark:bg-stone-950">
            {/* max-lg:pl-24 clears the threads drawer's floating launcher pill. */}
            <div className="shrink-0 pt-6 pl-6 pb-2 max-lg:pl-24 max-lg:pt-2.5 max-lg:pb-0 flex gap-1.5 items-center">
              <span className="font-extrabold text-2xl pb-1.5 max-lg:pb-0">
                CopilotKit
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/copilotkit-logo-mark.svg"
                alt="CopilotKit"
                className="h-7"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <CopilotChat
                attachments={{ enabled: true }}
                input={{ disclaimer: () => null, className: "pb-6" }}
              />
            </div>
          </div>
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}
