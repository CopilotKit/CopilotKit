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
      One CopilotChatConfigurationProvider owns the active thread for the whole
      surface. It is UNCONTROLLED (no `threadId` prop): the SDK <CopilotThreadsDrawer>
      drives it directly — picking a row sets the active thread, "+ New" resets
      to a fresh thread (clearing the chat), all with no host wiring. The chat
      and the canvas read the same active thread from the provider (the canvas's
      `useAgent()` falls back to it), so they stay on the same per-thread agent
      clone the chat's /connect replay populates.

      The drawer is mounted INSIDE the provider so it registers with the chat
      configuration — that's what surfaces the header thread-list launcher on
      mobile, where the drawer is an off-canvas modal rather than a sidebar.
    */
    <CopilotChatConfigurationProvider agentId="default">
      <div className={styles.layout}>
        {/*
          SDK threads drawer (replaces the former hand-rolled fork). SSR-safe and
          managed-project-backed, so it
          needs no example-level gate.
        */}
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
