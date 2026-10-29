import { CopilotKit } from "@copilotkit/react-core";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agentId="sample_agent"
      /* TODO(copilotkit-2.0): `threadId` is no longer a provider prop. Pass it to `<CopilotChat threadId>`, or wrap the chat in `<CopilotChatConfigurationProvider threadId>`. */ threadId="thread-1"
      /* TODO(copilotkit-2.0): `guardrails_c` was removed in 2.0. */ guardrails_c={{ validTopics: ["cooking"] }}
    >
      {children}
    </CopilotKit>
  );
}
