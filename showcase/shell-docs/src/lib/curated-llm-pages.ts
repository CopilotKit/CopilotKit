import type { LlmPage } from "./llm-text";
import { getDocsMode, getIntegrations } from "./registry";

export type CuratedLlmPage = Pick<LlmPage, "url" | "title" | "description">;

// Every visible external backend gets the same entry points. Registry order
// follows the docs framework selector; hidden integrations are not advertised.
export const CURATED_FRAMEWORK_PAGES: readonly CuratedLlmPage[] =
  getIntegrations()
    .filter(
      ({ slug }) => slug !== "built-in-agent" && getDocsMode(slug) !== "hidden",
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

/**
 * The default machine index is deliberately a small, ordered decision path.
 *
 * Selection policy:
 * - lead with product orientation, core interaction surfaces, and the
 *   persistence capabilities most applications need before production;
 * - include Slack and Microsoft Teams as first-class Channels entry points;
 * - keep one canonical route when several framework or channel variants share
 *   the same source; and
 * - publish every visible external framework's overview and quickstart in a
 *   separate leading section, before these shared and built-in agent guides.
 *
 * Contributor docs, migrations, legacy reference, troubleshooting, release
 * notes, generated API pages, narrow recipes, and repeated framework/channel
 * variants stay discoverable through `/llms-full.txt` instead.
 *
 * Titles and purposes are written for this index rather than copied from page
 * frontmatter so every entry is distinct and answers why an agent should open
 * the page. Route-validity and ordering tests make this hand-curated contract
 * fail when the underlying docs move.
 */
export const CURATED_LLM_PAGES = [
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
    url: "threads",
    title: "Rich Threads",
    description:
      "Build persistent conversations that restore messages, UI, inputs, and live runs across sessions.",
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
      "Evaluate the durability, memory, learning, inspection, and operations layer for production agents.",
  },
  {
    url: "slack",
    title: "Channels for Slack",
    description:
      "Bring an AG-UI agent into Slack with native messages and approvals through Channels and managed Intelligence connections.",
  },
  {
    url: "teams",
    title: "Channels for Microsoft Teams",
    description:
      "Build agents with native Microsoft Teams messages and approvals through Channels; review the managed integration availability and direct SDK options.",
  },
  {
    url: "langgraph-python/threads-import",
    title: "Import LangGraph and LangChain Threads",
    description:
      "Import existing LangGraph, LangSmith, or LangChain-authenticated thread history into Intelligence.",
  },
  {
    url: "google-adk/threads-import",
    title: "Import Google ADK Threads",
    description:
      "Import existing Google ADK sessions into Intelligence and keep future conversations synchronized.",
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
    title: "Open Source and Intelligence",
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
    url: "threads-self-managed",
    title: "Self-Managed Thread Persistence",
    description:
      "Plan the persistence responsibilities your application owns when it does not use Intelligence.",
  },
  {
    url: "intelligence/quickstart",
    title: "Intelligence Quickstart",
    description:
      "Connect an existing CopilotKit application to persistent threads in an Intelligence project.",
  },
  {
    url: "intelligence/memories",
    title: "Memories and Recall",
    description:
      "Choose memory scope and integrate long-term recall through React, Angular, REST, or MCP.",
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
    url: "frontends/vue",
    title: "Vue Frontend",
    description:
      "Connect a Vue application to Copilot Runtime with CopilotKit's Vue integration.",
  },
] as const satisfies readonly CuratedLlmPage[];
