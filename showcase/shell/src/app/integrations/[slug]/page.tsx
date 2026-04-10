import { notFound } from "next/navigation";
import {
  getIntegration,
  getIntegrations,
  getFeature,
  getCategoryLabel,
  getLanguageLabel,
} from "@/lib/registry";
import { ProfileClient } from "./profile-client";

export function generateStaticParams() {
  return getIntegrations().map((i) => ({ slug: i.slug }));
}

export default async function IntegrationProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const integration = getIntegration(slug);
  if (!integration) notFound();

  const featureInfos = integration.features.map((featureId) => {
    const feature = getFeature(featureId);
    return {
      id: featureId,
      name: feature?.name || featureId,
      hasDemo: integration.demos.some((d) => d.id === featureId),
    };
  });

  // Other integrations that share demo IDs — for framework switcher
  const allIntegrations = getIntegrations().filter(
    (i) => i.deployed && i.slug !== slug,
  );
  const demoAlternatives: Record<
    string,
    Array<{ slug: string; name: string; backendUrl: string }>
  > = {};
  for (const demo of integration.demos) {
    const alts = allIntegrations
      .filter((i) => i.demos.some((d) => d.id === demo.id))
      .map((i) => ({
        slug: i.slug,
        name: i.name,
        backendUrl: i.backend_url,
      }));
    if (alts.length > 0) {
      demoAlternatives[demo.id] = alts;
    }
  }

  return (
    <ProfileClient
      integration={integration}
      featureInfos={featureInfos}
      categoryLabel={getCategoryLabel(integration.category)}
      languageLabel={getLanguageLabel(integration.language)}
      demoAlternatives={demoAlternatives}
    />
  );
}
