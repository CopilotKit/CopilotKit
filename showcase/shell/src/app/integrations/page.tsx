import { getIntegrations } from "@/lib/registry";
import { IntegrationExplorer } from "@/components/integration-explorer";

export default function IntegrationsPage() {
    const integrations = getIntegrations();

    return <IntegrationExplorer integrations={integrations} />;
}
