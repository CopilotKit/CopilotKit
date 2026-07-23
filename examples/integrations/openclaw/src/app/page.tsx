"use client";

import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";
import { TokenGate } from "@/components/token-gate";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotThreadsDrawer,
} from "@copilotkit/react-core/v2";

import styles from "./page.module.css";

export default function HomePage() {
  // Frontend-tool demos (charts, meeting-picker, theme, tool-rendering) — these
  // work against any OpenClaw gateway running the clawg-ui fork.
  useGenerativeUIExamples();
  useExampleSuggestions();

  return (
    <CopilotChatConfigurationProvider agentId="default">
      <TokenGate>
        <div className={styles.layout}>
          <CopilotThreadsDrawer agentId="default" />
          <div className={styles.mainPanel}>
            <CopilotChat
              attachments={{ enabled: true }}
              input={{ disclaimer: () => null, className: "pb-6" }}
            />
          </div>
        </div>
      </TokenGate>
    </CopilotChatConfigurationProvider>
  );
}
