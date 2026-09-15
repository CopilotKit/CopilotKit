import { visibleIntegrations } from "./homepage-map";
import { compareByDisplayOrder } from "./framework-order";

export interface LandingIntegration {
  id: string;
  name: string;
  logoSlug: string;
  logo?: string;
  choices: { slug: string; name: string; secondary?: boolean }[];
}

const PRIORITY_GROUPS: Pick<LandingIntegration, "id" | "name" | "choices">[] = [
  {
    id: "copilotkit",
    name: "CopilotKit",
    choices: [{ slug: "built-in-agent", name: "CopilotKit" }],
  },
  {
    id: "deepagents",
    name: "DeepAgents",
    choices: [{ slug: "deepagents", name: "DeepAgents" }],
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
  const integrations = visibleIntegrations()
    .slice()
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  const bySlug = new Map(
    integrations.map((integration) => [integration.slug, integration]),
  );
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
