import type { CanMatchFn, Routes } from "@angular/router";

import frontendRegistryData from "./generated/frontend-registry.json";
import frontendCatalogData from "./generated/frontend-catalog.json";
import { isRunnableBrowserCell } from "./cell-context";
import type { BrowserCellCatalog } from "./cell-context";

type FeatureSupport = Record<string, { angular?: { state?: string } }>;

const support = frontendRegistryData.feature_support as FeatureSupport;
const supportedFeatures = Object.entries(support)
  .filter(([, declaration]) => declaration.angular?.state === "supported")
  .map(([feature]) => feature)
  .sort();

const catalog = frontendCatalogData as BrowserCellCatalog;
const canMatchRunnableCell: CanMatchFn = (route, segments) => {
  const integration = segments[0]?.path ?? "";
  const feature = route.data?.["feature"];
  return (
    typeof feature === "string" &&
    isRunnableBrowserCell(integration, feature, catalog)
  );
};

export const routes: Routes = [
  ...supportedFeatures.map((feature) => ({
    path: `:integration/${feature}`,
    title: `CopilotKit Angular — ${feature}`,
    data: { feature },
    canMatch: [canMatchRunnableCell],
    loadComponent: () =>
      import("./features/chat-feature.component").then(
        (module) => module.ChatFeatureComponent,
      ),
  })),
  {
    path: "**",
    title: "Angular Showcase — Unavailable",
    loadComponent: () =>
      import("./features/unavailable-feature.component").then(
        (module) => module.UnavailableFeatureComponent,
      ),
  },
];
