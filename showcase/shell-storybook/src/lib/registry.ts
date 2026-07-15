import registryJson from "../data/registry.json";
import { curatedResources } from "../content/resources";
import type { ResourceRef } from "../content/types";

const showcaseOrigin = "https://showcase.copilotkit.ai";
const docsOrigin = "https://docs.copilotkit.ai";

export type RegistryDemo = {
  id: string;
  name: string;
  description?: string;
  route?: string | null;
};

export type RegistryIntegration = {
  slug: string;
  name: string;
  repo?: string | null;
  demos: readonly RegistryDemo[];
};

export type RegistryFeatureCategory = {
  id: string;
  name: string;
};

export type RegistryFeature = {
  id: string;
  name: string;
  category: string;
  description: string;
  shell_docs_path?: string | null;
  og_docs_url?: string | null;
};

type ShowcaseRegistry = {
  integrations: readonly RegistryIntegration[];
  feature_registry: {
    categories: readonly RegistryFeatureCategory[];
    features: readonly RegistryFeature[];
  };
};

export type ResolvedDemo = {
  integrationName: string;
  demoName: string;
  route: string;
  repo?: string;
  storyHref: string;
  previewHref: string;
  codeHref: string;
};

export type ResolvedFeature = {
  name: string;
  categoryName: string;
  docsHref: string;
};

export type ResolvedResource = {
  kind: ResourceRef["kind"];
  label: string;
  href: string;
};

const registry: ShowcaseRegistry = registryJson;

export function resolveDemo(
  integrationId: string,
  demoId: string,
): ResolvedDemo {
  const integration = registry.integrations.find(
    ({ slug }) => slug === integrationId,
  );

  if (!integration) {
    throw new Error(`Unknown Showcase integration "${integrationId}".`);
  }

  const demo = integration.demos.find(({ id }) => id === demoId);

  if (!demo) {
    throw new Error(
      `Unknown Showcase demo "${demoId}" for integration "${integrationId}".`,
    );
  }

  if (!demo.route) {
    throw new Error(
      `Showcase demo "${demoId}" for integration "${integrationId}" is not runnable because it has no route.`,
    );
  }

  const storyHref = `${showcaseOrigin}/integrations/${integrationId}/${demoId}`;

  return {
    integrationName: integration.name,
    demoName: demo.name,
    route: demo.route,
    ...(integration.repo ? { repo: integration.repo } : {}),
    storyHref,
    previewHref: `${storyHref}/preview`,
    codeHref: `${storyHref}/code`,
  };
}

export function resolveFeature(featureId: string): ResolvedFeature {
  const feature = registry.feature_registry.features.find(
    ({ id }) => id === featureId,
  );

  if (!feature) {
    throw new Error(`Unknown Showcase feature "${featureId}".`);
  }

  const category = registry.feature_registry.categories.find(
    ({ id }) => id === feature.category,
  );

  if (!category) {
    throw new Error(
      `Unknown category "${feature.category}" for Showcase feature "${featureId}".`,
    );
  }

  const docsHref = feature.shell_docs_path
    ? `${docsOrigin}${feature.shell_docs_path}`
    : feature.og_docs_url;

  if (!docsHref) {
    throw new Error(
      `Showcase feature "${featureId}" has no documentation destination.`,
    );
  }

  return {
    name: feature.name,
    categoryName: category.name,
    docsHref,
  };
}

export function resolveResource(ref: ResourceRef): ResolvedResource {
  switch (ref.kind) {
    case "curated": {
      const resource = curatedResources[ref.id];

      if (!resource) {
        throw new Error(`Unknown curated resource "${String(ref.id)}".`);
      }

      return { kind: "curated", ...resource };
    }
    case "demo": {
      const demo = resolveDemo(ref.integration, ref.demo);

      switch (ref.view) {
        case "story":
          return {
            kind: "demo",
            label: `Open ${demo.demoName} story`,
            href: demo.storyHref,
          };
        case "preview":
          return {
            kind: "demo",
            label: `Open ${demo.demoName} live demo`,
            href: demo.previewHref,
          };
        case "code":
          return {
            kind: "demo",
            label: `View ${demo.demoName} code`,
            href: demo.codeHref,
          };
      }
    }
    case "feature": {
      const feature = resolveFeature(ref.feature);

      return {
        kind: "feature",
        label: `Read ${feature.name} docs`,
        href: feature.docsHref,
      };
    }
  }
}
