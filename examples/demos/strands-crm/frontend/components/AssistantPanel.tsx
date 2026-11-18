"use client";
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export function AssistantPanel() {
  return (
    <CopilotSidebar
      defaultOpen
      width={420}
      labels={{
        modalHeaderTitle: "Northstar Assistant",
        welcomeMessageText:
          "Hi — I can help you work your pipeline. Ask about deals, research an account, or draft a follow-up.",
        chatInputPlaceholder: "Ask anything about your pipeline…",
      }}
    />
  );
}
