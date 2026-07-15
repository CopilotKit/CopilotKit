import type { ArtifactId } from "./concepts";
import type { CuratedResourceId } from "./resources";

export const personaSlugs = [
  "marketing-lead",
  "partnerships-lead",
  "partnerships-engineer",
  "product-lead",
  "oss-lead",
  "oss-engineer",
  "ceo",
  "cto",
  "head-of-sales",
  "sales-team-member",
] as const;

export type PersonaSlug = (typeof personaSlugs)[number];

export type PersonaGroup =
  | "leadership"
  | "go-to-market"
  | "partnerships"
  | "oss";

export type Composition =
  | "statement"
  | "diagram"
  | "live-proof"
  | "artifact"
  | "action";

export type ConceptId = "ecosystem" | "proof" | "ownership" | "audience";

export type ResourceRef =
  | { kind: "curated"; id: CuratedResourceId }
  | {
      kind: "demo";
      integration: string;
      demo: string;
      view: "story" | "preview" | "code";
    }
  | { kind: "feature"; feature: string };

export type VisualRef =
  | { kind: "illustration"; concept: ConceptId; alt: string }
  | { kind: "system-map" }
  | { kind: "manifest-flow" }
  | { kind: "proof-flow" }
  | {
      kind: "ownership-handoff";
      perspective: "partnerships" | "oss";
    }
  | { kind: "coverage-map" }
  | { kind: "demo"; integration: string; demo: string }
  | { kind: "artifact"; artifact: ArtifactId }
  | { kind: "checklist"; items: readonly string[] };

export type DeepDive = {
  label: "Go deeper";
  summary: string;
  commands?: readonly string[];
  paths?: readonly string[];
  failureModes?: readonly string[];
};

export type StoryPage = {
  slug: string;
  title: string;
  claim: string;
  body: string;
  composition: Composition;
  visual: VisualRef;
  resources: readonly ResourceRef[];
  deepDive?: DeepDive;
};

export type Persona = {
  slug: PersonaSlug;
  name: string;
  group: PersonaGroup;
  summary: string;
  question: string;
  minutes: number;
  systemOwner?: true;
  pages: readonly StoryPage[];
};
