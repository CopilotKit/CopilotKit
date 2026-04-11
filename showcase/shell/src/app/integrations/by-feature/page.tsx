import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
} from "@/lib/registry";
import { IntegrationsTabs } from "@/components/integrations-tabs";
import { FeatureCatalog } from "@/components/feature-catalog";

export default function ByFeaturePage() {
  const integrations = getIntegrations();
  const features = getFeatures();
  const categories = getFeatureCategories();

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <IntegrationsTabs />
      </div>
      <FeatureCatalog
        features={features}
        categories={categories}
        integrations={integrations}
      />
    </div>
  );
}
