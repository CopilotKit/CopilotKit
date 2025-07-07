"use client";

import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import { Message } from "@copilotkit/runtime-client-gql";
import { CodePreview } from "@/components/content/code-preview";
import "@copilotkit/react-ui/styles.css";
import { useEffect } from "react";

const Chat = () => {
  return (
    <CopilotKit publicApiKey={process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY}>
      <div style={{ 
        "--copilot-kit-primary-color": "var(--primary)",
        "--copilot-kit-background-color": "var(--background)",
      } as CopilotKitCSSProperties}>
        <CustomUserMessage />
      </div>
    </CopilotKit>
  )
}

const CustomUserMessage = () => {
  return (
    <CopilotChat
      className="h-96"
      labels={{
        initial: [
          "The answer to life is 42. Would you like to know why?",
        ],
      }}
    />
  )
}

export function CustomUserMessagePreview({ children }: { children: React.ReactNode }) {
  return (
    <CodePreview preview={<Chat />}>
      {children}
    </CodePreview>
  )
}