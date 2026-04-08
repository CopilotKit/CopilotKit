"use client";

import { useState } from "react";
import { ExampleLayout } from "@/components/example-layout";
import { ExampleCanvas } from "@/components/example-canvas";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";

import { CopilotChat } from "@copilotkit/react-core/v2";

import styles from "@/components/threads-drawer/threads-drawer.module.css";

export default function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  return (
    <div className={styles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={setThreadId}
      />
      <div className={styles.mainPanel}>
        <ExampleLayout
          chatContent={
            <CopilotChat
              agentId="default"
              threadId={threadId}
              input={{ disclaimer: () => null, className: "pb-6" }}
            />
          }
          appContent={<ExampleCanvas />}
        />
      </div>
    </div>
  );
}
