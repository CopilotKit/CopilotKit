import {
  getDocsMode,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "@/components/docs-mdx/data";

// `/llms.txt`, ported verbatim from shell-docs (`CURATED_LLM_PAGES` and
// `CURATED_FRAMEWORK_PAGES` in its src/lib/curated-llm-pages.ts, and
// `renderLlmsIndex()` in its src/lib/llm-text.ts): a short, ordered decision
// index rather than every page. `/llms-full.txt` carries everything else.

interface CuratedPage {
  /** Path without the leading slash; "" is the docs home. */
  url: string;
  title: string;
  description: string;
}

/** The canonical onboarding prompt's host (shell-docs' `ONBOARDING_PROMPT_ORIGIN`). */
const ONBOARDING_PROMPT_ORIGIN = "https://copilotkit.ai";

/** Every visible external framework's overview and quickstart, in registry order. */
function curatedFrameworkPages(): CuratedPage[] {
  return getIntegrations()
    .filter(
      ({ slug }) => slug !== ROOT_FRAMEWORK && getDocsMode(slug) !== "hidden",
    )
    .flatMap(({ slug, name }) => [
      {
        url: slug,
        title: `${name} Integration`,
        description: `Explore ${name}-specific capabilities, examples, and guides for connecting your existing agent to CopilotKit.`,
      },
      {
        url: `${slug}/quickstart`,
        title: `${name} Quickstart`,
        description: `Connect your ${name} backend to CopilotKit using the setup instructions for this framework.`,
      },
    ]);
}

/**
 * The default machine index is a small, ordered decision path: product
 * orientation, core interaction surfaces, the persistence capabilities most
 * apps need, Slack and Teams, then the built-in agent's guides. Titles and
 * purposes are written for this index, not copied from frontmatter.
 */
const CURATED_LLM_PAGES: readonly CuratedPage[] = [
  {
    url: "",
    title: "CopilotKit Documentation",
    description:
      "Choose the CopilotKit frontend, agent connection, and production path for your application.",
  },
  {
    url: "agentic-chat-ui",
    title: "Chat UI",
    description:
      "Choose a prebuilt or customizable chat surface for conversations between users and agents.",
  },
  {
    url: "concepts/generative-ui-overview",
    title: "Generative UI",
    description:
      "Compare CopilotKit's generative UI approaches and select the right rendering model.",
  },
  {
    url: "human-in-the-loop",
    title: "Human-in-the-Loop",
    description:
      "Choose how an agent pauses for user input, review, or approval before continuing.",
  },
  {
    url: "AG-UI-Streams",
    title: "AG-UI Streams",
    description:
      "Keep framework threads and add Intelligence’s AG-UI streams for reconnection, catch-up, and delivery across devices.",
  },
  {
    url: "learning",
    title: "Automatic Learning",
    description:
      "Turn evidence from completed application workflows into reviewed, reusable agent skills.",
  },
  {
    url: "intelligence/overview",
    title: "CopilotKit Intelligence",
    description:
      "Evaluate AG-UI Streams, User Memories, Automatic Learning, Product Analytics, and Channels for your existing agent and frontend.",
  },
  {
    url: "slack",
    title: "Channels for Slack",
    description:
      "Bring an AG-UI agent into Slack with native messages and approvals through Channels and cloud-hosted Intelligence connections.",
  },
  {
    url: "teams",
    title: "Channels for Microsoft Teams",
    description:
      "Bring an AG-UI agent into Microsoft Teams with native messages and approvals through generally available cloud-hosted Intelligence connections or direct SDK options.",
  },
  {
    url: "langgraph-python/threads-import",
    title: "Add AG-UI Streams to LangGraph Threads",
    description:
      "Connect Intelligence for ongoing AG-UI delivery; optionally import earlier LangGraph Server, Platform, or LangSmith Deployment history exposed through the thread and run APIs.",
  },
  {
    url: "google-adk/threads-import",
    title: "Add AG-UI Streams to ADK Sessions",
    description:
      "Connect Intelligence for ongoing AG-UI delivery alongside ADK persistence; optionally import earlier sessions from supported ADK stores.",
  },
  {
    url: "quickstart",
    title: "Built-in Agent Quickstart",
    description:
      "Build a working agent chat with CopilotKit's built-in agent in a few focused steps.",
  },
  {
    url: "cli",
    title: "CopilotKit CLI",
    description:
      "Create an application, choose an agent framework, and connect optional Intelligence services.",
  },
  {
    url: "concepts/architecture",
    title: "CopilotKit Architecture",
    description:
      "Understand how the frontend, runtime, agent, and AG-UI event stream fit together.",
  },
  {
    url: "concepts/which-hook",
    title: "Hook Selection Guide",
    description:
      "Choose the correct frontend hook for tools, rendering, human review, or custom chat.",
  },
  {
    url: "concepts/oss-vs-enterprise",
    title: "Open source vs Intelligence",
    description:
      "Decide which capabilities belong to the open-source stack and which require Intelligence.",
  },
  {
    url: "agentic-protocols/ag-ui",
    title: "AG-UI Integration",
    description:
      "Connect a framework-agnostic agent backend to CopilotKit through the open AG-UI protocol.",
  },
  {
    url: "backend/copilot-runtime",
    title: "Copilot Runtime",
    description:
      "Configure the server-side layer that authenticates, routes, and connects frontend requests to agents.",
  },
  {
    url: "backend/custom-agent",
    title: "Bring Your Own Model Runtime",
    description:
      "Use a custom model router or AI SDK implementation behind CopilotKit's built-in agent interface.",
  },
  {
    url: "backend/custom-ag-ui-agent",
    title: "Write Your Own AG-UI Agent",
    description:
      "Extend AbstractAgent, register it in the runtime, and override clone for constructor fields.",
  },
  {
    url: "backend/self-managed-agents",
    title: "Self-Managed Agents",
    description:
      "Connect agents that you host and secure yourself through a compatible AG-UI endpoint.",
  },
  {
    url: "runtime-server-adapter",
    title: "Runtime Deployment",
    description:
      "Choose a server adapter for Node.js, Express, Hono, Bun, Deno, or Cloudflare Workers.",
  },
  {
    url: "model-selection",
    title: "Built-in Agent Model Selection",
    description:
      "Select and configure the model provider used by CopilotKit's built-in agent.",
  },
  {
    url: "prebuilt-components",
    title: "Prebuilt Chat Components",
    description:
      "Choose among embedded chat, sidebar, and popup components for a ready-made interface.",
  },
  {
    url: "headless",
    title: "Headless Chat UI",
    description:
      "Build a fully custom chat experience while retaining CopilotKit's agent and rendering primitives.",
  },
  {
    url: "frontend-tools",
    title: "Frontend Tools",
    description:
      "Expose browser-side actions that an agent can discover, call, and await.",
  },
  {
    url: "server-tools",
    title: "Built-in Agent Server Tools",
    description:
      "Define backend actions that the built-in agent can execute securely on the server.",
  },
  {
    url: "shared-state",
    title: "Shared State",
    description:
      "Create a two-way state connection between your application UI and its agent.",
  },
  {
    url: "threads-lifecycle",
    title: "Thread Lifecycle",
    description:
      "Understand thread creation, restoration, switching, and framework persistence boundaries.",
  },
  {
    url: "intelligence/quickstart",
    title: "Intelligence Quickstart",
    description:
      "Connect an existing CopilotKit application to persistent threads in an Intelligence project.",
  },
  {
    url: "intelligence/memories",
    title: "User Memories",
    description:
      "Choose memory scope and integrate long-term recall through React, Angular, REST, or MCP.",
  },
  {
    url: "intelligence/analytics",
    title: "Product Analytics",
    description:
      "Understand how people use your agent with project-level usage, thread, and tool-call data.",
  },
  {
    url: "auth",
    title: "Authentication",
    description:
      "Forward verified user identity from the frontend through the runtime to the agent.",
  },
  {
    url: "angular",
    title: "Angular Frontend",
    description:
      "Start with CopilotKit's first-party, signal-based Angular frontend integration.",
  },
  {
    url: "frontends/react-native",
    title: "React Native Frontend",
    description:
      "Start a mobile CopilotKit application with the required Metro and polyfill setup.",
  },
  {
    url: "frontends/react-spa",
    title: "React SPA Frontend",
    description:
      "Connect a React single-page application to a separately hosted Copilot Runtime.",
  },
  {
    url: "vue",
    title: "Vue Frontend",
    description:
      "Connect a Vue application to Copilot Runtime with CopilotKit's Vue integration.",
  },
];

/** The `/llms.txt` body, with absolute links on `baseUrl`. */
export function renderLlmsIndex(baseUrl: string): string {
  const out: string[] = [
    "# CopilotKit Docs",
    "",
    "> CopilotKit is the frontend stack where agents meet users, connected to supported agent frameworks through AG-UI.",
    "",
    "> AG-UI streams, formerly known as Rich Threads, are Intelligence’s delivery layer. Keep framework threads and existing SDK identifiers such as useThreads and threadId.",
    "",
    "> This curated index covers chat, generative UI, human-in-the-loop workflows, AG-UI Streams, User Memories, Automatic Learning, Product Analytics, and Channels for Slack and Microsoft Teams.",
    "",
    `> For exhaustive retrieval—including reference, migration, contributor, and additional framework and channel guides—use [llms-full.txt](${baseUrl}/llms-full.txt).`,
    "",
    "Use the user's stated goals, known project context, existing frontend and agent framework, and constraints to explain which parts of CopilotKit are relevant and why, then offer the smallest useful next step. For an existing project, work with its stack; if another known project fits better, suggest it. Without context, offer a few concrete examples or ask a focused question. Keep research separate from execution: do not start installation for a research request. Coding agents can use the canonical onboarding prompt below; assistants without terminal access should explain the options and hand off to a coding agent or the linked docs.",
    "",
    "## Add CopilotKit with your coding agent",
    "",
    "Use the same canonical onboarding prompt for any of these starting points:",
    "",
    "- **Greenfield:** Start a new project with CopilotKit, including when there is no frontend or agent yet.",
    "- **Brownfield:** Add CopilotKit to an existing application, agent backend, or both, working with the existing stack.",
    "- **Existing open-source CopilotKit:** Connect a working open-source CopilotKit project to Intelligence.",
    "",
    "The onboarding workflow inspects the project, identifies its starting point, and guides the coding agent through the appropriate setup. For a new project, run the prompt from its intended project directory. For an existing project, run it from the project root. For product research or comparisons, continue to the documentation links without running onboarding.",
    "",
    `This is the same prompt offered by the **Copy onboarding prompt** button on the [docs home](${baseUrl}/). A coding agent can use the text directly; a chat assistant without project or terminal access can give it to the user to paste into their coding agent.`,
    "",
    `Open the [canonical onboarding prompt](${ONBOARDING_PROMPT_ORIGIN}/onboarding-prompts) when ready to implement. This stable entry creates a fresh run ID for the session.`,
    "",
    "## How to read these docs",
    "",
    `- **Connect an existing app and agent:** Read your framework's overview and quickstart below together with [Architecture](${baseUrl}/concepts/architecture) and the relevant frontend guide.`,
    `- **Build an interaction:** Read [Chat UI](${baseUrl}/agentic-chat-ui), [Generative UI](${baseUrl}/concepts/generative-ui-overview), and [Human-in-the-Loop](${baseUrl}/human-in-the-loop) together, then use your framework's implementation guides.`,
    `- **Keep conversation history:** Read [AG-UI Streams](${baseUrl}/AG-UI-Streams) and [Thread Lifecycle](${baseUrl}/threads-lifecycle) together; keep your existing thread provider or use CopilotKit's built-in thread store. To layer AG-UI Streams and Automatic Learning onto LangChain/LangGraph, Google ADK, or Mastra without migrating your stack, read [Add AG-UI Streams to Existing Threads](${baseUrl}/threads-import) and the available framework guides below to add Intelligence and optionally include earlier history, with supported sources and source-specific limits. Copying historical conversations does not establish ongoing database replication; configure future runs through CopilotKit separately.`,
    `- **Evaluate Intelligence:** Read [Open source vs Intelligence](${baseUrl}/concepts/oss-vs-enterprise) with the [Intelligence overview](${baseUrl}/intelligence/overview), then follow the capability and deployment guides relevant to your project.`,
    "",
  ];

  const frameworkPages = curatedFrameworkPages();
  if (frameworkPages.length > 0) {
    out.push(
      "## Use your existing agent framework",
      "",
      "If the user already has an agent backend, start with its integration and quickstart below, then follow that framework's guides for tools, generative UI, human-in-the-loop, state, and threads. CopilotKit works with these backends through AG-UI; adopting the built-in agent is not required. Bare root implementation guides can describe CopilotKit's built-in agent and should not replace framework-specific guidance.",
      "",
    );
    for (const page of frameworkPages) {
      out.push(`- [${page.title}](${baseUrl}/${page.url}): ${page.description}`);
    }
    out.push("");
  }

  out.push("## Capabilities, frontends, and shared guides", "");
  for (const page of CURATED_LLM_PAGES) {
    out.push(
      `- [${page.title || page.url}](${baseUrl}/${page.url}): ${page.description}`,
    );
  }
  return `${out.join("\n")}\n`;
}
