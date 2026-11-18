import {
  CopilotChat,
  CopilotKitProvider,
  type CopilotKitProviderProps,
  useAgent,
} from "@copilotkit/react-core";

export function Layout({ children, renderToolCalls }: CopilotKitProviderProps) {
  const { agent } = useAgent();
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="sample_agent"
      renderToolCalls={renderToolCalls}
      injectStyles={false}
    >
      <CopilotChat />
      {children}
    </CopilotKitProvider>
  );
}
