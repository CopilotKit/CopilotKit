import { CopilotKit, type CopilotKitProps } from "@copilotkit/react-core";
import {
  CopilotKitProvider,
  type CopilotKitProviderProps,
  useAgent,
} from "@copilotkit/react-core";

export const Legacy = ({ children }: CopilotKitProps) => (
  <CopilotKit runtimeUrl="/api/copilotkit" agent="sample_agent">
    {children}
  </CopilotKit>
);

export const Current = ({ children }: CopilotKitProviderProps) => {
  const { agent } = useAgent();
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>
  );
};
