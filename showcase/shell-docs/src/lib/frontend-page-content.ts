import type { FrontendId } from "./frontend-options";
import type { NavNode } from "./docs-render";

export type FrontendPageId = Exclude<FrontendId, "react">;

export interface FrontendQuickstartStep {
  title: string;
  body: string;
  code?: {
    language: string;
    filename?: string;
    value: string;
  };
}

export interface FrontendReferenceLink {
  label: string;
  href: string;
  description: string;
}

export interface FrontendPageContent {
  id: FrontendPageId;
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  prerequisites: string[];
  steps: FrontendQuickstartStep[];
  references: FrontendReferenceLink[];
}

export const FRONTEND_PAGE_CONTENT: Record<
  FrontendPageId,
  FrontendPageContent
> = {
  vue: {
    id: "vue",
    eyebrow: "Frontend quickstart",
    title: "Vue",
    description:
      "Add CopilotKit to a Vue 3 app with the Vue provider, package styles, and chat primitives.",
    status: "Quickstart now. Full Vue docs are catching up.",
    prerequisites: [
      "A Vue 3 app",
      "A CopilotKit runtime endpoint, self-hosted or cloud",
      "Node.js 20 or newer",
    ],
    steps: [
      {
        title: "Install the Vue package",
        body: "Install the Vue bindings alongside the shared CopilotKit core package.",
        code: {
          language: "bash",
          value: "pnpm add @copilotkit/vue @copilotkit/core",
        },
      },
      {
        title: "Import styles once",
        body: "The Vue package ships its own styles, so import them from your app entry or root component.",
        code: {
          language: "ts",
          filename: "main.ts",
          value: 'import "@copilotkit/vue/styles.css";',
        },
      },
      {
        title: "Wrap your app",
        body: "Point the provider at your CopilotKit runtime endpoint. The endpoint can connect to any AG-UI compatible agent backend.",
        code: {
          language: "vue",
          filename: "App.vue",
          value: `<script setup lang="ts">
import { CopilotKitProvider, CopilotChat } from "@copilotkit/vue";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <CopilotChat agent-id="default" />
  </CopilotKitProvider>
</template>`,
        },
      },
    ],
    references: [
      {
        label: "Vue package README",
        href: "https://github.com/CopilotKit/CopilotKit/tree/main/packages/vue",
        description: "Current package usage, provider props, and slot APIs.",
      },
      {
        label: "Vue Storybook",
        href: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/v2/vue/storybook",
        description: "Parity examples for Vue chat and rendering primitives.",
      },
      {
        label: "AG-UI concepts",
        href: "/ag-ui/concepts/architecture",
        description: "How frontend apps connect to agent backends.",
      },
    ],
  },
  "react-native": {
    id: "react-native",
    eyebrow: "Frontend quickstart",
    title: "React Native",
    description:
      "Connect a React Native or Expo app to CopilotKit with mobile-safe polyfills and native chat surfaces.",
    status: "Quickstart now. The deeper platform guide remains available.",
    prerequisites: [
      "A React Native 0.70+ or Expo app",
      "A CopilotKit runtime endpoint reachable from the simulator or device",
      "Node.js 20 or newer",
    ],
    steps: [
      {
        title: "Install the package",
        body: "Install the React Native bindings. If you use the prebuilt chat UI, install the listed peer dependencies too.",
        code: {
          language: "bash",
          value:
            "pnpm add @copilotkit/react-native @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated react-native-streamdown",
        },
      },
      {
        title: "Load polyfills first",
        body: "Import the CopilotKit polyfills before your app imports any CopilotKit code.",
        code: {
          language: "tsx",
          filename: "index.js",
          value: `import "@copilotkit/react-native/polyfills";

import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);`,
        },
      },
      {
        title: "Wrap your app and render chat",
        body: "Use a device-reachable runtime URL. Physical devices usually need your machine IP instead of localhost.",
        code: {
          language: "tsx",
          filename: "App.tsx",
          value: `import {
  CopilotChat,
  CopilotKitProvider,
} from "@copilotkit/react-native";

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-server/api/copilotkit">
      <CopilotChat placeholder="Ask anything..." />
    </CopilotKitProvider>
  );
}`,
        },
      },
    ],
    references: [
      {
        label: "React Native platform guide",
        href: "/react-native",
        description: "Full setup, headless usage, and troubleshooting.",
      },
      {
        label: "React Native package README",
        href: "https://github.com/CopilotKit/CopilotKit/tree/main/packages/react-native",
        description: "Package API surface and import paths.",
      },
      {
        label: "API reference",
        href: "/reference",
        description: "Shared hooks and components that React Native builds on.",
      },
    ],
  },
  slack: {
    id: "slack",
    eyebrow: "Channel quickstart",
    title: "Slack",
    description:
      "Use Slack as the user-facing surface for an agent connected through CopilotKit and AG-UI.",
    status:
      "Channel docs are intentionally small while full Slack coverage is built.",
    prerequisites: [
      "A Slack app with event subscriptions enabled",
      "A server endpoint that receives Slack events",
      "A CopilotKit runtime or AG-UI compatible backend",
    ],
    steps: [
      {
        title: "Create the Slack app",
        body: "Create a Slack app, enable event subscriptions, and route message events to your server.",
      },
      {
        title: "Connect the event handler to your agent",
        body: "Use your server handler to translate Slack messages into an agent run against your CopilotKit runtime or AG-UI backend.",
      },
      {
        title: "Send the response back to Slack",
        body: "Return assistant messages as Slack messages or blocks. Keep tool approvals and rich UI states on your product surface until the Slack adapter docs are expanded.",
      },
    ],
    references: [
      {
        label: "AG-UI quickstart",
        href: "/ag-ui/quickstart/introduction",
        description: "Protocol basics for connecting channels to agents.",
      },
      {
        label: "Runtime docs",
        href: "/backend/copilot-runtime",
        description: "How CopilotKit hosts and connects agent runtimes.",
      },
      {
        label: "API reference",
        href: "/reference",
        description: "Shared primitives for the product-side experience.",
      },
    ],
  },
  teams: {
    id: "teams",
    eyebrow: "Channel quickstart",
    title: "Teams",
    description:
      "Use Microsoft Teams as the user-facing channel for an agent connected through CopilotKit and AG-UI.",
    status:
      "Channel docs are intentionally small while full Teams coverage is built.",
    prerequisites: [
      "A Microsoft Teams app or bot registration",
      "A server endpoint that receives Teams activity events",
      "A CopilotKit runtime or AG-UI compatible backend",
    ],
    steps: [
      {
        title: "Create the Teams app",
        body: "Create a Teams app or bot registration and route message activities to your server.",
      },
      {
        title: "Connect the activity handler to your agent",
        body: "Translate Teams activities into agent runs against your CopilotKit runtime or AG-UI backend.",
      },
      {
        title: "Send the response back to Teams",
        body: "Return assistant messages as Teams activities or adaptive cards. Keep product-specific approvals and rich UI states in your app until the Teams adapter docs are expanded.",
      },
    ],
    references: [
      {
        label: "AG-UI quickstart",
        href: "/ag-ui/quickstart/introduction",
        description: "Protocol basics for connecting channels to agents.",
      },
      {
        label: "Runtime docs",
        href: "/backend/copilot-runtime",
        description: "How CopilotKit hosts and connects agent runtimes.",
      },
      {
        label: "API reference",
        href: "/reference",
        description: "Shared primitives for the product-side experience.",
      },
    ],
  },
};

export const FRONTEND_PAGE_IDS = Object.keys(
  FRONTEND_PAGE_CONTENT,
) as FrontendPageId[];

export function getFrontendPageContent(
  id: FrontendId,
): FrontendPageContent | null {
  if (id === "react") return null;
  return FRONTEND_PAGE_CONTENT[id];
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  return [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Quickstart", slug: `frontends/${id}` },
    { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
    {
      type: "page",
      title: "React docs for deeper examples",
      slug: "",
    },
  ];
}
