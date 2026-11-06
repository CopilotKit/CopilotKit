import { CopilotKit } from "@copilotkit/react-core";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="sample_agent"
      threadId="thread-1"
      guardrails_c={{ validTopics: ["cooking"] }}
    >
      {children}
    </CopilotKit>
  );
}
