"use client";

import { ExampleLayout } from "@/components/example-layout";
import { ExampleCanvas } from "@/components/example-canvas";
import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotThreadsDrawer,
} from "@copilotkit/react-core/v2";

import styles from "./page.module.css";

export default function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  return (
    /*
      One UNCONTROLLED CopilotChatConfigurationProvider (no `threadId` prop) owns
      the active thread for the whole surface. The SDK <CopilotThreadsDrawer> drives it
      directly — picking a row sets the active thread, "+ New" resets to a fresh
      thread (clearing the chat) — with no host thread-state. The chat and the
      canvas read the same active thread from the provider (the canvas's
      `useAgent()` falls back to it), so they stay on the same per-thread agent
      clone the chat's /connect replay populates. A *controlled* provider would
      block "+ New" from resetting the chat, so uncontrolled-inside-provider is
      required, not optional.
    */
    <CopilotChatConfigurationProvider agentId="default">
      <div className={styles.layout}>
        {/* SDK threads drawer (replaces the hand-rolled fork). License-gated: the locked view's Upgrade CTA opens the Intelligence docs by default. */}
        <CopilotThreadsDrawer agentId="default" />
        <div className={styles.mainPanel}>
          <ExampleLayout
            chatContent={
              <CopilotChat
                attachments={{ enabled: true }}
                input={{ disclaimer: () => null, className: "pb-6" }}
              />
            }
            appContent={<ExampleCanvas />}
          />
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
}
