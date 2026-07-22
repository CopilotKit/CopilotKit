import type { CanMatchFn, Routes } from "@angular/router";

import frontendRegistryData from "./generated/frontend-registry.json";
import frontendCatalogData from "./generated/frontend-catalog.json";
import {
  isRunnableBrowserCell,
  readAngularRuntimeConfig,
} from "./cell-context";
import type { BrowserCellCatalog } from "./cell-context";

type FeatureSupport = Record<string, { angular?: { state?: string } }>;

const support = frontendRegistryData.feature_support as FeatureSupport;
const supportedFeatures = Object.entries(support)
  .filter(([, declaration]) => declaration.angular?.state === "supported")
  .map(([feature]) => feature)
  .sort();

const catalog = frontendCatalogData as BrowserCellCatalog;
export type FeatureComponentKey =
  | "popup"
  | "sidebar"
  | "chat-slots"
  | "chat-css"
  | "headless-simple"
  | "headless-complete"
  | "tools"
  | "interrupt"
  | "a2ui"
  | "generated-ui"
  | "mcp-apps"
  | "state"
  | "reasoning"
  | "agent-state"
  | "app-settings"
  | "media"
  | "beautiful-chat"
  | "mastra"
  | "chat";

/** Select the smallest lazy feature family that implements a showcase route. */
export function resolveFeatureComponentKey(
  feature: string,
): FeatureComponentKey {
  switch (feature) {
    case "prebuilt-popup":
      return "popup";
    case "prebuilt-sidebar":
      return "sidebar";
    case "chat-slots":
      return "chat-slots";
    case "chat-customization-css":
      return "chat-css";
    case "headless-simple":
      return "headless-simple";
    case "headless-complete":
      return "headless-complete";
    case "gen-ui-tool-based":
    case "tool-rendering-default-catchall":
    case "tool-rendering-custom-catchall":
    case "tool-rendering":
    case "tool-rendering-reasoning-chain":
    case "frontend-tools":
    case "frontend-tools-async":
    case "threadid-frontend-tool-roundtrip":
    case "hitl-in-chat":
    case "hitl-in-app":
      return "tools";
    case "gen-ui-interrupt":
    case "interrupt-headless":
      return "interrupt";
    case "declarative-gen-ui":
    case "a2ui-fixed-schema":
    case "a2ui-recovery":
      return "a2ui";
    case "open-gen-ui":
    case "open-gen-ui-advanced":
      return "generated-ui";
    case "mcp-apps":
      return "mcp-apps";
    case "shared-state-read-write":
    case "shared-state-read":
    case "shared-state-streaming":
    case "readonly-state-agent-context":
      return "state";
    case "reasoning-default":
    case "reasoning-custom":
      return "reasoning";
    case "gen-ui-agent":
    case "subagents":
      return "agent-state";
    case "background-agents":
    case "observational-memory":
    case "browser-use":
      return "mastra";
    case "auth":
    case "agent-config":
      return "app-settings";
    case "voice":
    case "multimodal":
      return "media";
    case "beautiful-chat":
      return "beautiful-chat";
    case "agentic-chat":
      return "chat";
    default:
      throw new Error(
        `Feature "${feature}" does not have an Angular implementation.`,
      );
  }
}

/** Resolve a feature to its canonical lazy Angular implementation. */
function loadFeatureComponent(feature: string) {
  switch (resolveFeatureComponentKey(feature)) {
    case "popup":
      return () =>
        import("./features/popup-feature.component").then(
          (module) => module.PopupFeatureComponent,
        );
    case "mastra":
      return () =>
        import("./features/mastra/mastra-feature.component").then(
          (module) => module.MastraFeatureComponent,
        );
    case "sidebar":
      return () =>
        import("./features/sidebar-feature.component").then(
          (module) => module.SidebarFeatureComponent,
        );
    case "chat-slots":
      return () =>
        import("./features/chat-slots-feature.component").then(
          (module) => module.ChatSlotsFeatureComponent,
        );
    case "chat-css":
      return () =>
        import("./features/chat-css-feature.component").then(
          (module) => module.ChatCssFeatureComponent,
        );
    case "headless-simple":
      return () =>
        import("./features/headless/headless-simple-feature.component").then(
          (module) => module.HeadlessSimpleFeatureComponent,
        );
    case "headless-complete":
      return () =>
        import("./features/headless/headless-complete-feature.component").then(
          (module) => module.HeadlessCompleteFeatureComponent,
        );
    case "tools":
      return () =>
        import("./features/tools/tool-feature.component").then(
          (module) => module.ToolFeatureComponent,
        );
    case "interrupt":
      return () =>
        import("./features/interrupt/interrupt-feature.component").then(
          (module) => module.InterruptFeatureComponent,
        );
    case "a2ui":
      return () =>
        import("./features/a2ui/a2ui-feature.component").then(
          (module) => module.A2UIFeatureComponent,
        );
    case "generated-ui":
      return () =>
        import("./features/generated-ui/generated-ui-feature.component").then(
          (module) => module.GeneratedUIFeatureComponent,
        );
    case "mcp-apps":
      return () =>
        import("./features/generated-ui/mcp-apps-feature.component").then(
          (module) => module.MCPAppsFeatureComponent,
        );
    case "state":
      return () =>
        import("./features/state/state-feature.component").then(
          (module) => module.StateFeatureComponent,
        );
    case "reasoning":
      return () =>
        import("./features/reasoning-feature.component").then(
          (module) => module.ReasoningFeatureComponent,
        );
    case "agent-state":
      return () =>
        import("./features/agent-state/agent-state-feature.component").then(
          (module) => module.AgentStateFeatureComponent,
        );
    case "app-settings":
      return () =>
        import("./features/app-settings/app-settings-feature.component").then(
          (module) => module.AppSettingsFeatureComponent,
        );
    case "media":
      return () =>
        import("./features/media/media-feature.component").then(
          (module) => module.MediaFeatureComponent,
        );
    case "beautiful-chat":
      return () =>
        import("./features/beautiful-chat/beautiful-chat-feature.component").then(
          (module) => module.BeautifulChatFeatureComponent,
        );
    case "chat":
      return () =>
        import("./features/chat-feature.component").then(
          (module) => module.ChatFeatureComponent,
        );
  }
}

const canMatchRunnableCell: CanMatchFn = (route) => {
  const integration = readAngularRuntimeConfig()?.integrationId ?? "";
  const feature = route.data?.["feature"];
  return (
    typeof feature === "string" &&
    isRunnableBrowserCell(integration, feature, catalog)
  );
};

export const routes: Routes = [
  ...supportedFeatures.map((feature) => ({
    path: feature,
    title: `CopilotKit Angular — ${feature}`,
    data: { feature },
    canMatch: [canMatchRunnableCell],
    loadComponent: loadFeatureComponent(feature),
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
