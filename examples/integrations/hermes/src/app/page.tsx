"use client";

import { useState } from "react";

import { ExampleLayout } from "@/components/example-layout";
import { ExampleCanvas } from "@/components/example-canvas";
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
        {/*
          Wrap both the chat and the canvas in one CopilotChatConfigurationProvider
          so they share the active threadId. `useAgent()` falls back to the
          provider's threadId when called without an explicit one, which makes
          the canvas read from the same per-thread agent clone that the chat's
          /connect replay populates. Without this wrapper, the canvas resolves
          to the registry agent and never receives STATE_SNAPSHOT events on
          thread resume.
        */}
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <ExampleLayout
            chatContent={
              <CopilotChat
                attachments={{ enabled: true }}
                input={{ disclaimer: () => null, className: "pb-6" }}
              />
            }
            appContent={<ExampleCanvas />}
          />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}
