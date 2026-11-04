"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { STAGE_WINDOW, Stage, isCommandLang } from "@/components/brand/stage";
import { brandDark, brandLight } from "./code-theme";
import { frameworkById, type FrontendId } from "./data";

// Snippets use APIs checked in this repo (packages/react-core, vue, angular,
// react-native, runtime). Feature examples exist for React only so far.

export function Code({
  code,
  lang = "tsx",
  title,
}: {
  code: string;
  lang?: string;
  title?: string;
}) {
  const options = { themes: { light: brandLight, dark: brandDark } };
  // Code sits on the same stage as a live demo, as a white window; commands
  // take a compact frame.
  return (
    <Stage compact={isCommandLang(lang)} className="my-2">
      <DynamicCodeBlock
        lang={lang}
        code={code}
        codeblock={{ title, className: `my-0 ${STAGE_WINDOW}` }}
        options={options}
      />
    </Stage>
  );
}

export function installCommand(frontend: FrontendId): string {
  const pkg = {
    react: "@copilotkit/react-core",
    vue: "@copilotkit/vue",
    angular: "@copilotkit/angular",
    "react-native": "@copilotkit/react-native",
    slack:
      "@copilotkit/channels @copilotkit/channels-ui @copilotkit/channels-slack",
    teams:
      "@copilotkit/channels @copilotkit/channels-ui @copilotkit/channels-teams @microsoft/agents-hosting @microsoft/agents-activity",
  }[frontend];
  return `npm install ${pkg} @copilotkit/runtime`;
}

/** Channels run inside the runtime, so their setup is the bot itself. */
function channelSnippet(adapter: "slack" | "teams") {
  const imports =
    adapter === "slack"
      ? `import { slack } from "@copilotkit/channels-slack";`
      : `import { teams } from "@copilotkit/channels-teams";`;
  const adapterCall =
    adapter === "slack"
      ? `slack({
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
    })`
      : `teams({ port: 3978 })`;
  return {
    title: "bot.ts",
    lang: "ts",
    code: `import { createChannel } from "@copilotkit/channels";
${imports}
import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2";

const bot = createChannel({
  name: "support-bot",
  identifyUser: "platform",
  adapters: [
    ${adapterCall},
  ],
  agent: (threadId) => makeAgent(threadId),
});

bot.onMention(({ thread }) => thread.runAgent());

// The runtime owns the channel's lifecycle.
export const runtime = new CopilotRuntime({
  intelligence: new CopilotKitIntelligence({
    apiKey: process.env.CPK_INTELLIGENCE_API_KEY!,
  }),
  channels: [bot],
});`,
  };
}

export function providerSnippet(frontend: FrontendId): {
  title: string;
  lang: string;
  code: string;
} {
  switch (frontend) {
    case "slack":
    case "teams":
      return channelSnippet(frontend);
    case "vue":
      return {
        title: "src/App.vue",
        lang: "vue",
        code: `<script setup lang="ts">
import { CopilotKit } from "@copilotkit/vue";
</script>

<template>
  <CopilotKit runtime-url="/api/copilotkit">
    <RouterView />
  </CopilotKit>
</template>`,
      };
    case "angular":
      return {
        title: "src/app/app.config.ts",
        lang: "ts",
        code: `import type { ApplicationConfig } from "@angular/core";
import { provideCopilotKit } from "@copilotkit/angular";

export const appConfig: ApplicationConfig = {
  providers: [provideCopilotKit({ runtimeUrl: "/api/copilotkit" })],
};

// In a template: <copilot-chat />`,
      };
    case "react-native":
      return {
        title: "App.tsx",
        lang: "tsx",
        code: `import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-native";

export default function App() {
  return (
    <CopilotKitProvider runtimeUrl="https://your-app.com/api/copilotkit">
      <CopilotChat />
    </CopilotKitProvider>
  );
}`,
      };
    default:
      return {
        title: "app/page.tsx",
        lang: "tsx",
        code: `import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <CopilotChat />
    </CopilotKitProvider>
  );
}`,
      };
  }
}

export function runtimeSnippet(frameworkId: string): string {
  const name = frameworkById(frameworkId)?.name ?? frameworkId;
  let imports: string;
  let agent: string;
  if (frameworkId === "mastra") {
    imports = `import { getLocalAgent } from "@ag-ui/mastra";\nimport { mastra } from "@/mastra";`;
    agent = `getLocalAgent({ mastra, agentId: "weatherAgent" })`;
  } else if (
    frameworkId === "langgraph-python" ||
    frameworkId === "langgraph-typescript"
  ) {
    imports = `import { LangGraphAgent } from "@copilotkit/runtime/langgraph";`;
    agent = `new LangGraphAgent({\n        deploymentUrl: process.env.LANGGRAPH_URL!,\n        graphId: "agent",\n      })`;
  } else {
    imports = `import { HttpAgent } from "@ag-ui/client";`;
    agent = `new HttpAgent({ url: process.env.AGENT_URL! }) // your ${name} agent`;
  }
  return `import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
${imports}

const handler = createCopilotRuntimeHandler({
  runtime: new CopilotRuntime({
    agents: {
      default: ${agent},
    },
  }),
  basePath: "/api/copilotkit",
});

export { handler as GET, handler as POST };`;
}

export function featureSnippet(topic: string): string | null {
  switch (topic) {
    case "generative-ui":
      return `useFrontendTool({
  name: "showWeather",
  description: "Show the weather for a city",
  handler: async ({ city }) => getWeather(city),
  render: ({ args, result }) => <WeatherCard city={args.city} data={result} />,
});`;
    case "human-in-the-loop":
      return `useHumanInTheLoop({
  name: "confirmTransfer",
  description: "Ask the user before moving money",
  render: ({ args, respond }) => (
    <ConfirmCard amount={args.amount} onAnswer={respond} />
  ),
});`;
    case "shared-state":
      return `const { agent } = useAgent();
// agent.state is the agent's state, live; agent.setState writes back.`;
    case "threads":
      return `<CopilotChat threadId={threadId} />`;
    default:
      return null;
  }
}
