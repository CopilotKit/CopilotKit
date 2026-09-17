import type { Integration } from "./registry";

/** A historical, manually assessed snapshot. Never infer deployed versions from manifests. */
export const COMPATIBILITY_SNAPSHOT = {
  date: "August 19, 2026",
  assessedAt: "2026-08-19T07:37:31Z",
  revision: "9dec75e4ca164e06fb4304efb952af9d9d90520e",
  rubric: "2.0",
  source:
    "https://app.notion.com/p/copilotkit/scorecard-3c23aa381852803dae5cf99a2e76979f",
  methodology:
    "https://app.notion.com/p/copilotkit/executive-summary-3c13aa38185280eb903ec600e6c7d0b5",
} as const;

export interface SdkAssessment {
  name: string;
  running: string;
  latest: string;
  graceTarget: string;
  /** The scorecard abbreviates the Microsoft registry targets to release lines. */
  targetsAreReleaseLines?: boolean;
  score: number;
}

export interface CompatibilityAssessment {
  score: number;
  packages: SdkAssessment[];
}

// Slugs intentionally match the generated Showcase registry. Package scores
// follow the source's currency curve; variant scores are imported, not live.
const assessments: Record<string, CompatibilityAssessment> = {
  strands: {
    score: 100,
    packages: [
      {
        name: "strands-agents",
        running: "1.52.0",
        latest: "1.52.0",
        graceTarget: "1.48.0",
        score: 100,
      },
    ],
  },
  "strands-typescript": {
    score: 60,
    packages: [
      {
        name: "@strands-agents/sdk",
        running: "1.1.0",
        latest: "1.13.0",
        graceTarget: "1.10.0",
        score: 60,
      },
    ],
  },
  "ms-agent-python": {
    score: 100,
    packages: [
      {
        name: "agent-framework-ag-ui",
        running: "1.1.0",
        latest: "1.1",
        graceTarget: "1.0",
        targetsAreReleaseLines: true,
        score: 100,
      },
      {
        name: "agent-framework-core",
        running: "1.14.0",
        latest: "1.14",
        graceTarget: "1.11",
        targetsAreReleaseLines: true,
        score: 100,
      },
      {
        name: "agent-framework-openai",
        running: "1.13.0",
        latest: "1.13",
        graceTarget: "1.10",
        targetsAreReleaseLines: true,
        score: 100,
      },
    ],
  },
  "ms-agent-dotnet": {
    score: 60,
    packages: [
      {
        name: "Microsoft.Agents.AI.OpenAI",
        running: "1.0.0-preview.251110.1",
        latest: "1.18",
        graceTarget: "1.13",
        targetsAreReleaseLines: true,
        score: 60,
      },
      {
        name: "Microsoft.Agents.AI.Hosting.AGUI.AspNetCore",
        running: "1.0.0-preview.251110.1",
        latest: "1.18-preview.260818",
        graceTarget: "1.13-preview.260703",
        targetsAreReleaseLines: true,
        score: 60,
      },
    ],
  },
};

export interface CompatibilityVariant {
  slug: string;
  name: string;
  label: string;
  assessment: CompatibilityAssessment | null;
}

export interface CompatibilityPlatform {
  id: string;
  name: string;
  variants: CompatibilityVariant[];
}

const families: Record<string, { id: string; name: string; label: string }> = {
  "langgraph-python": { id: "langgraph", name: "LangGraph", label: "Python" },
  "langgraph-typescript": {
    id: "langgraph",
    name: "LangGraph",
    label: "TypeScript",
  },
  "langgraph-fastapi": { id: "langgraph", name: "LangGraph", label: "FastAPI" },
  "ms-agent-python": {
    id: "ms-agent-python",
    name: "MAF Python",
    label: "Python",
  },
  "ms-agent-dotnet": {
    id: "ms-agent-dotnet",
    name: "MAF .NET",
    label: ".NET",
  },
  "ms-agent-harness-dotnet": {
    id: "ms-agent-harness-dotnet",
    name: ".NET Harness",
    label: ".NET Harness",
  },
  strands: { id: "strands", name: "AWS Strands Python", label: "Python" },
  "strands-typescript": {
    id: "strands-typescript",
    name: "AWS Strands TypeScript",
    label: "TypeScript",
  },
  "claude-sdk-python": {
    id: "claude",
    name: "Claude Agent SDK",
    label: "Python",
  },
  "claude-sdk-typescript": {
    id: "claude",
    name: "Claude Agent SDK",
    label: "TypeScript",
  },
  "crewai-crews": { id: "crewai", name: "CrewAI", label: "Flows" },
  "crewai-conversational-flows": {
    id: "crewai",
    name: "CrewAI",
    label: "Conversational flows",
  },
};

const languageLabels: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  dotnet: ".NET",
  java: "Java",
};

/** Preserve Coverage's order and include new registry entries as unassessed. */
export function getCompatibilityPlatforms(
  integrations: Integration[],
): CompatibilityPlatform[] {
  const platforms = new Map<string, CompatibilityPlatform>();
  for (const integration of integrations) {
    const family = families[integration.slug];
    const id = family?.id ?? integration.slug;
    let platform = platforms.get(id);
    if (!platform) {
      platform = { id, name: family?.name ?? integration.name, variants: [] };
      platforms.set(id, platform);
    }
    platform.variants.push({
      slug: integration.slug,
      name: integration.name,
      label:
        family?.label ??
        languageLabels[integration.language] ??
        integration.language,
      assessment: assessments[integration.slug] ?? null,
    });
  }
  return [...platforms.values()];
}

export type CompatibilityFilter = "all" | "assessed" | "upgrade";

export function filterCompatibilityPlatforms(
  platforms: CompatibilityPlatform[],
  query: string,
  filter: CompatibilityFilter,
): CompatibilityPlatform[] {
  const term = query.trim().toLowerCase();
  return platforms.filter((platform) => {
    const matchesStatus =
      filter === "all" ||
      platform.variants.some(
        ({ assessment }) =>
          assessment !== null &&
          (filter === "assessed" || assessment.score < 100),
      );
    const searchable = [
      platform.name,
      ...platform.variants.flatMap((variant) => [
        variant.name,
        variant.label,
        variant.slug,
        ...(variant.assessment?.packages.map((sdk) => sdk.name) ?? []),
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return matchesStatus && searchable.includes(term);
  });
}
