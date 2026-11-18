import {
  CopilotChat,
  CopilotKit,
  type CopilotKitProps,
  useAgent,
} from "@copilotkit/react-core";

export function Layout({ children, renderToolCalls }: CopilotKitProps) {
  const { agent } = useAgent();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agentId="sample_agent"
      renderToolCalls={renderToolCalls}
      injectStyles={false}
    >
      <CopilotChat />
      {children}
    </CopilotKit>
  );
}
