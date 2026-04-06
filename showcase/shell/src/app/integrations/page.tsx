import { getIntegrations } from "@/lib/registry";
import { IntegrationExplorer } from "@/components/integration-explorer";
import { IntegrationsTabs } from "@/components/integrations-tabs";

export default function IntegrationsPage() {
    const integrations = getIntegrations();

    return (
        <div className="px-6 py-8">
            <div className="mx-auto max-w-7xl">
                <IntegrationsTabs />
            </div>
            <IntegrationExplorer integrations={integrations} />
        </div>
    );
}
