import { CopilotKitProvider } from "@copilotkit/react-core";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="sample_agent"
      /* TODO(copilotkit-2.0): `threadId` is no longer a provider prop. Pass it to `<CopilotChat threadId>`, or wrap the chat in `<CopilotChatConfigurationProvider threadId>`. */ threadId="thread-1"
      /* TODO(copilotkit-2.0): `guardrails_c` was removed in 2.0. */ guardrails_c={{ validTopics: ["cooking"] }}
      /* TODO(copilotkit-2.0): 2.0 calls `onError` with `{ error, code, context }`, not the v1 `CopilotErrorEvent`: read the error kind from `code` (it was `type`), and `timestamp` is gone. */ onError={(event) => console.error(event.type, event.error)}
    >
      {children}
    </CopilotKitProvider>
  );
}
