"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotDrawer,
} from "@copilotkit/react-core/v2";

import styles from "./page.module.css";

const agentId = "default";

export default function CopilotKitPage() {
  return (
    /*
      One UNCONTROLLED CopilotChatConfigurationProvider (no `threadId` prop) owns
      the active thread for the whole surface. The SDK <CopilotDrawer> drives it
      directly — picking a row sets the active thread, "+ New" resets to a fresh
      thread (clearing the chat) — with no host thread-state. The chat reads the
      same active thread from the provider. A *controlled* provider would block
      "+ New" from resetting, so uncontrolled-inside-provider is required.
    */
    <CopilotChatConfigurationProvider agentId={agentId}>
      <div className={`${styles.layout} threadsLayout`}>
        {/* SDK threads drawer (replaces the hand-rolled fork). License-gated
            with its own upsell; onUpsell opens the Intelligence docs for parity
            with the fork's "Learn more" CTA. */}
        <CopilotDrawer
          agentId={agentId}
          onUpsell={() =>
            window.open(
              "https://docs.copilotkit.ai/intelligence",
              "_blank",
              "noopener,noreferrer",
            )
          }
        />
        <div className={styles.mainPanel}>
          <main className="h-full w-full flex justify-center items-center">
            <CopilotChat agentId={agentId} className="w-full max-w-3xl h-full" />
          </main>
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
}
