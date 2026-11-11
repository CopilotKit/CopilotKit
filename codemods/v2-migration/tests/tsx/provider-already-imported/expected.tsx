import {
  CopilotKitProvider,
  type CopilotKitProviderProps,
  useAgent,
} from "@copilotkit/react-core";

export const Legacy = ({ children }: CopilotKitProviderProps) => (
  <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="sample_agent">
    {children}
  </CopilotKitProvider>
);

export const Current = ({ children }: CopilotKitProviderProps) => {
  const { agent } = useAgent();
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>
  );
};
