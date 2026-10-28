// Server-only: the agent frameworks a picker lists, grouped by family, from
// the showcase registry (shell-docs' lib/landing-integrations.ts,
// integration-groups.ts and framework-order.ts).

import { getDocsMode, getIntegrations } from "../data";

export interface LandingIntegration {
  id: string;
  name: string;
  logoSlug: string;
  logo?: string;
  choices: { slug: string; name: string; secondary?: boolean }[];
}

/** Partner-agreed display order; the Built-in Agent is pinned separately. */
const FRAMEWORK_DISPLAY_ORDER: readonly string[] = [
  "deepagents",
  "langgraph-python",
  "langgraph-fastapi",
  "langgraph-typescript",
  "google-adk",
  "strands",
  "strands-typescript",
  "mastra",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "pydantic-ai",
  "ms-agent-python",
  "ms-agent-dotnet",
  "ms-agent-harness-dotnet",
  "ag2",
  "agno",
  "llamaindex",
  "langroid",
  "spring-ai",
  "crewai-crews",
];

function compareByDisplayOrder(a: string, b: string): number {
  const ai = FRAMEWORK_DISPLAY_ORDER.indexOf(a);
  const bi = FRAMEWORK_DISPLAY_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

const PRIORITY_GROUPS: Pick<LandingIntegration, "id" | "name" | "choices">[] =
  [
    {
      id: "copilotkit",
      name: "CopilotKit",
      choices: [{ slug: "built-in-agent", name: "CopilotKit" }],
    },
    {
      id: "deepagents",
      name: "Langchain DeepAgents",
      choices: [{ slug: "deepagents", name: "Langchain DeepAgents" }],
    },
    {
      id: "langchain",
      name: "LangChain",
      choices: [
        { slug: "langgraph-python", name: "Python" },
        { slug: "langgraph-typescript", name: "TypeScript" },
        {
          slug: "langgraph-fastapi",
          name: "Python with FastAPI",
          secondary: true,
        },
      ],
    },
    {
      id: "google-adk",
      name: "Google ADK",
      choices: [{ slug: "google-adk", name: "Google ADK" }],
    },
    {
      id: "strands",
      name: "AWS Strands",
      choices: [
        { slug: "strands", name: "Python" },
        { slug: "strands-typescript", name: "TypeScript" },
      ],
    },
    {
      id: "microsoft-agent-framework",
      name: "Microsoft Agent Framework",
      choices: [
        { slug: "ms-agent-python", name: "Python" },
        { slug: "ms-agent-dotnet", name: ".NET" },
      ],
    },
    {
      id: "mastra",
      name: "Mastra",
      choices: [{ slug: "mastra", name: "Mastra" }],
    },
  ];

/** Group language variants without losing any visible registry destination. */
export function landingIntegrations(): LandingIntegration[] {
  const integrations = getIntegrations()
    .filter((integration) => getDocsMode(integration.slug) !== "hidden")
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  const bySlug = new Map(integrations.map((i) => [i.slug, i]));
  const grouped = new Set<string>();
  const result: LandingIntegration[] = [];
  for (const group of PRIORITY_GROUPS) {
    const choices = group.choices.filter((choice) => bySlug.has(choice.slug));
    if (choices.length === 0) continue;
    const first = bySlug.get(choices[0].slug)!;
    choices.forEach((choice) => grouped.add(choice.slug));
    result.push({ ...group, choices, logoSlug: first.slug, logo: first.logo });
  }
  for (const integration of integrations) {
    if (grouped.has(integration.slug)) continue;
    result.push({
      id: integration.slug,
      name: integration.name,
      logoSlug: integration.slug,
      logo: integration.logo,
      choices: [{ slug: integration.slug, name: integration.name }],
    });
  }
  return result;
}
