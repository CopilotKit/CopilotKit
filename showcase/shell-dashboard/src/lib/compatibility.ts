import { COMPATIBILITY_SNAPSHOT } from "@/data/compatibility-snapshot";
import type {
  CompatibilitySnapshotPackage,
  CompatibilitySnapshotRow,
  CompatibilitySnapshotStatus,
} from "@/data/compatibility-snapshot";
import type { Integration } from "./registry";

export { COMPATIBILITY_SNAPSHOT };

export interface SdkAssessment extends CompatibilitySnapshotPackage {}

export interface CompatibilityAssessment {
  currentScore: number | null;
  status: CompatibilitySnapshotStatus;
  label: string;
  packages: SdkAssessment[];
}

export interface CompatibilityVariant {
  slug: string;
  name: string;
  label: string;
  assessment: CompatibilityAssessment;
}

export interface CompatibilityPlatform {
  id: string;
  name: string;
  variants: CompatibilityVariant[];
}

const assessments = new Map<string, CompatibilitySnapshotRow>(
  COMPATIBILITY_SNAPSHOT.rows.map((row) => [row.slug, row]),
);

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

const statusLabels: Record<CompatibilitySnapshotStatus, string> = {
  build_verified_fallback_scored: "Scored",
  source_declared_prototype_scored: "Scored",
  policy_pending_or_incomplete_package_score: "Not scored",
  not_verified: "Not verified",
  stale_historical_only_not_current: "Not verified",
  internal_non_comparable: "Not applicable",
};

function toAssessment(row: CompatibilitySnapshotRow): CompatibilityAssessment {
  return {
    currentScore: row.currentScore,
    status: row.status,
    label: statusLabels[row.status],
    packages: row.packages
      .filter((pkg) => pkg.drivesCompatibility)
      .map((pkg) => ({ ...pkg })),
  };
}

export function getCompatibilityPlatforms(
  integrations: Integration[],
): CompatibilityPlatform[] {
  const platforms = new Map<string, CompatibilityPlatform>();
  for (const integration of integrations) {
    const row = assessments.get(integration.slug);
    if (!row) continue;

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
      assessment: toAssessment(row),
    });
  }
  return [...platforms.values()];
}

export type CompatibilityFilter = "all" | "scored" | "attention";

export function filterCompatibilityPlatforms(
  platforms: CompatibilityPlatform[],
  query: string,
  filter: CompatibilityFilter,
): CompatibilityPlatform[] {
  const term = query.trim().toLowerCase();
  return platforms.filter((platform) => {
    const matchesStatus =
      filter === "all" ||
      platform.variants.some(({ assessment }) => {
        if (filter === "scored") return assessment.currentScore !== null;
        return (
          assessment.currentScore === null &&
          assessment.status !== "internal_non_comparable"
        );
      });
    const searchable = [
      platform.name,
      ...platform.variants.flatMap((variant) => [
        variant.name,
        variant.label,
        variant.slug,
        variant.assessment.label,
        ...(variant.assessment.packages.flatMap((sdk) => [
          sdk.name,
          sdk.role,
          sdk.runningVersion ?? "",
          sdk.latest ?? "",
          sdk.graceTarget ?? "",
        ]) ?? []),
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return matchesStatus && searchable.includes(term);
  });
}
