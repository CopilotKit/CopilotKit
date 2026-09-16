import catalog from "@/data/frontend-catalog.json";
import type { FrontendId } from "@/lib/frontend-options";

export interface PartnerShowcaseDemo {
  id: string;
  title: string;
  description: string;
  href: string;
}

const FEATURE_COPY: Record<string, { title: string; description: string }> = {
  "agentic-chat": {
    title: "Chat",
    description: "Talk to your agent in a ready-made chat interface.",
  },
  "gen-ui-tool-based": {
    title: "Interactive UI",
    description: "Turn your agent’s responses into interactive components.",
  },
  "hitl-in-chat": {
    title: "Human approvals",
    description: "Review a decision before your agent takes the next step.",
  },
  "shared-state-read-write": {
    title: "Shared state",
    description: "Keep your app and agent in sync as they work.",
  },
};
const FEATURE_ORDER = Object.keys(FEATURE_COPY);

/** Server-only selection: never substitute another backend or advertise a missing cell. */
export function partnerShowcaseDemos(
  integration: string,
  frontend: FrontendId = "react",
): PartnerShowcaseDemo[] {
  const cells = catalog.cells.filter(
    (cell) =>
      cell.frontend === frontend &&
      cell.integration === integration &&
      cell.runnable,
  );
  return cells
    .filter((cell) => FEATURE_ORDER.includes(cell.feature))
    .sort(
      (a, b) =>
        FEATURE_ORDER.indexOf(a.feature) - FEATURE_ORDER.indexOf(b.feature),
    )
    .map((cell) => ({
      id: cell.feature,
      ...FEATURE_COPY[cell.feature],
      href: `https://showcase.copilotkit.ai/${frontend}/${integration}/${cell.feature}`,
    }));
}
