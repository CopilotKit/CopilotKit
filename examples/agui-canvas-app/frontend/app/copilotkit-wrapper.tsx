import { AppLayout } from "@/components/app-layout";
import { AgentProvider, useAgent } from "@/lib/agent-provider";
import { CopilotKit } from "@copilotkit/react-core";

export function CopilotKitWrapper() {
    const { currentAgent } = useAgent();
    return (
        <CopilotKit runtimeUrl="/api/copilotkit" agent={currentAgent?.id}>
            <AppLayout />
        </CopilotKit>
    )
}
