import registryJson from "../data/registry.json";
import { curatedResources } from "../content/resources";
import type { ResourceRef } from "../content/types";

const showcaseOrigin = "https://showcase.copilotkit.ai";
const docsOrigin = "https://docs.copilotkit.ai";

function validateHttpsDestination(
  href: string,
  context: string,
  options: { base?: string; requiredOrigin?: string } = {},
): string {
  let destination: URL;

  try {
    destination = new URL(href, options.base);
  } catch {
    throw new Error(`${context} must be a valid HTTPS URL.`);
  }

  if (destination.protocol !== "https:") {
    throw new Error(`${context} must use HTTPS.`);
  }

  if (options.requiredOrigin && destination.origin !== options.requiredOrigin) {
    throw new Error(`${context} must remain on "${options.requiredOrigin}".`);
  }

  return options.base ? destination.href : href;
}

type RegistryDemo = {
  id: string;
  name: string;
  description?: string;
  route?: string | null;
};

type RegistryIntegration = {
  slug: string;
  name: string;
  repo?: string | null;
  demos: readonly RegistryDemo[];
};

type RegistryFeatureCategory = {
  id: string;
  name: string;
};

type RegistryFeature = {
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

type ResolvedDemo = {
  integrationName: string;
  demoName: string;
  route: string;
  repo?: string;
  storyHref: string;
  previewHref: string;
  codeHref: string;
};

type ResolvedFeature = {
  name: string;
  categoryName: string;
  docsHref: string;
};

type ResolvedResource = {
  kind: ResourceRef["kind"];
  label: string;
  href: string;
};

export function createRegistryResolver(registry: ShowcaseRegistry) {
  function resolveDemoFromRegistry(
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

    const storyHref = `${showcaseOrigin}/integrations/${encodeURIComponent(
      integrationId,
    )}/${encodeURIComponent(demoId)}`;
    const repo =
      integration.repo == null
        ? undefined
        : validateHttpsDestination(
            integration.repo,
            `Repository destination for integration "${integrationId}"`,
          );

    return {
      integrationName: integration.name,
      demoName: demo.name,
      route: demo.route,
      ...(repo ? { repo } : {}),
      storyHref,
      previewHref: `${storyHref}/preview`,
      codeHref: `${storyHref}/code`,
    };
  }

  function resolveFeatureFromRegistry(featureId: string): ResolvedFeature {
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

    let docsHref: string;

    if (feature.shell_docs_path) {
      docsHref = validateHttpsDestination(
        feature.shell_docs_path,
        `Shell docs destination for feature "${featureId}"`,
        { base: docsOrigin, requiredOrigin: docsOrigin },
      );
    } else if (feature.og_docs_url) {
      docsHref = validateHttpsDestination(
        feature.og_docs_url,
        `Original docs destination for feature "${featureId}"`,
      );
    } else {
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

  function resolveResourceFromRegistry(ref: ResourceRef): ResolvedResource {
    switch (ref.kind) {
      case "curated": {
        const resource = curatedResources[ref.id];

        if (!resource) {
          throw new Error(`Unknown curated resource "${String(ref.id)}".`);
        }

        return {
          kind: "curated",
          label: resource.label,
          href: validateHttpsDestination(
            resource.href,
            `Curated resource "${String(ref.id)}" destination`,
          ),
        };
      }
      case "demo": {
        const view: unknown = ref.view;

        switch (view) {
          case "story":
          case "preview":
          case "code":
            break;
          default:
            throw new Error(
              `Unknown demo resource view "${String(view)}" for integration "${ref.integration}" and demo "${ref.demo}".`,
            );
        }

        const demo = resolveDemoFromRegistry(ref.integration, ref.demo);
        const labelByView = {
          story: `Open ${demo.demoName} story`,
          preview: `Open ${demo.demoName} live demo`,
          code: `View ${demo.demoName} code`,
        } as const;
        const hrefByView = {
          story: demo.storyHref,
          preview: demo.previewHref,
          code: demo.codeHref,
        } as const;

        return {
          kind: "demo",
          label: labelByView[view],
          href: hrefByView[view],
        };
      }
      case "feature": {
        const feature = resolveFeatureFromRegistry(ref.feature);

        return {
          kind: "feature",
          label: `Read ${feature.name} docs`,
          href: feature.docsHref,
        };
      }
      default:
        throw new Error(
          `Unknown resource kind "${String(
            (ref as { kind?: unknown }).kind,
          )}".`,
        );
    }
  }

  return {
    resolveDemo: resolveDemoFromRegistry,
    resolveFeature: resolveFeatureFromRegistry,
    resolveResource: resolveResourceFromRegistry,
  };
}

const generatedRegistryResolver = createRegistryResolver(registryJson);

export function resolveDemo(
  integrationId: string,
  demoId: string,
): ResolvedDemo {
  return generatedRegistryResolver.resolveDemo(integrationId, demoId);
}

export function resolveFeature(featureId: string): ResolvedFeature {
  return generatedRegistryResolver.resolveFeature(featureId);
}

export function resolveResource(ref: ResourceRef): ResolvedResource {
  return generatedRegistryResolver.resolveResource(ref);
}
