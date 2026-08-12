export interface AngularFeatureSearchEntry {
  type: "page";
  title: string;
  subtitle: string;
  section: "Angular features";
  href: string;
}

interface FrontendRegistry {
  feature_support: Record<
    string,
    {
      angular?: {
        state: string;
        docs?: { name: string; description: string };
      };
    }
  >;
}

interface FeatureRegistry {
  features: Array<{ id: string; name: string; description: string }>;
}

/** Build search entries from the supported Angular declarations. */
export function buildAngularFeatureSearchEntries(
  frontendRegistry: FrontendRegistry,
  featureRegistry: FeatureRegistry,
): AngularFeatureSearchEntry[] {
  return Object.entries(frontendRegistry.feature_support)
    .filter(([, declaration]) => declaration.angular?.state === "supported")
    .map(([id, declaration]) => {
      const feature = featureRegistry.features.find(
        (candidate) => candidate.id === id,
      );
      if (!feature) {
        throw new Error(
          `Supported Angular feature ${JSON.stringify(id)} is missing from the feature registry.`,
        );
      }

      return {
        type: "page" as const,
        title: `${declaration.angular?.docs?.name ?? feature.name} — Angular example`,
        subtitle: declaration.angular?.docs?.description ?? feature.description,
        section: "Angular features" as const,
        href: `/angular/features#${id}`,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}
