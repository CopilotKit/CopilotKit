import { getIntegrations } from "@/lib/registry";
import { IntegrationExplorer } from "@/components/integration-explorer";
import { IntegrationsTabs } from "@/components/integrations-tabs";

interface IntegrationsPageProps {
  searchParams: Promise<{ feature?: string }>;
}

export default async function IntegrationsPage({
  searchParams,
}: IntegrationsPageProps) {
  const integrations = getIntegrations();
  const params = await searchParams;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <IntegrationsTabs />
      </div>
      <IntegrationExplorer
        integrations={integrations}
        initialFeatureFilter={params.feature}
      />
    </div>
  );
}
