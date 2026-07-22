import frontendCatalogData from "@/data/frontend-catalog.json";
import frontendRegistryData from "@/data/frontend-registry.json";
import registryData from "@/data/registry.json";

export interface AngularFeatureDoc {
  id: string;
  name: string;
  description: string;
  state: "supported";
  integration: string;
  runnable: boolean;
  runHref: string | null;
  sourceHref: string;
  apiHref: string;
}

interface CatalogCell {
  frontend: string;
  integration: string;
  feature: string;
  runnable: boolean;
}

const API_BY_FEATURE: Record<string, string> = {
  "prebuilt-popup": "/reference/angular/components/CopilotPopup",
  "prebuilt-sidebar": "/reference/angular/components/CopilotSidebar",
  "frontend-tools": "/reference/angular/functions/registerFrontendTool",
  "frontend-tools-async": "/reference/angular/functions/registerFrontendTool",
  "gen-ui-interrupt": "/reference/angular/functions/registerHumanInTheLoop",
  "interrupt-headless": "/reference/angular/functions/injectInterrupt",
  "hitl-in-chat": "/reference/angular/functions/registerHumanInTheLoop",
  "hitl-in-app": "/reference/angular/functions/registerHumanInTheLoop",
  "mcp-apps": "/reference/angular/functions/provideMCPApps",
};

/** Build drift-checked docs links for every supported Angular feature. */
export function getAngularFeatureDocs(): AngularFeatureDoc[] {
  const support = (
    frontendRegistryData as {
      feature_support: Record<string, { angular: { state: string } }>;
    }
  ).feature_support;
  const features = (
    registryData as {
      feature_registry: {
        features: Array<{ id: string; name: string; description: string }>;
      };
    }
  ).feature_registry.features;
  const cells = (frontendCatalogData as { cells: CatalogCell[] }).cells;

  return Object.entries(support)
    .filter(([, declaration]) => declaration.angular.state === "supported")
    .map(([id]) => {
      const feature = features.find((candidate) => candidate.id === id);
      const runnableCell = cells.find(
        (candidate) =>
          candidate.frontend === "angular" &&
          candidate.feature === id &&
          candidate.runnable,
      );
      const cell =
        runnableCell ??
        cells.find(
          (candidate) =>
            candidate.frontend === "angular" && candidate.feature === id,
        );
      if (!feature || !cell) {
        throw new Error(
          `Supported Angular feature ${JSON.stringify(id)} needs docs metadata and a catalog cell.`,
        );
      }

      const route = `https://showcase.copilotkit.ai/angular/${cell.integration}/${id}`;
      return {
        id,
        name: feature.name,
        description: feature.description,
        state: "supported" as const,
        integration: cell.integration,
        runnable: runnableCell !== undefined,
        runHref: runnableCell ? route : null,
        sourceHref: `${route}/code`,
        apiHref: API_BY_FEATURE[id] ?? "/reference/angular/public-api",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
