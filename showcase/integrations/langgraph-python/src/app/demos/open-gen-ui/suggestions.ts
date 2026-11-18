import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestion `message` strings double as deterministic aimock fixture keys.
// Keep them short, distinctive, and aligned with the fixture entries in
// `showcase/aimock/d6/langgraph-python/gen-ui-open.json` so each pill click produces a stable
// `generateSandboxedUi` tool call (rather than getting absorbed by a
// generic catch-all fixture). Titles below the message use the same
// short label so the pill copy reads as a natural human prompt.
const minimalSuggestions = [
  {
    title: "Q3 pipeline by region & stage",
    message: "Compare our Q3 pipeline by region and stage",
  },
  {
    title: "Cloud spend by service",
    message: "Break down this month's cloud spend by service, with the trend",
  },
  {
    title: "Support tickets by theme",
    message:
      "Summarize this week's support tickets by theme, with counts and examples",
  },
  {
    title: "Retention by signup cohort",
    message: "Show 6-month customer retention by signup cohort",
  },
];

export function useOpenGenUISuggestions() {
  useConfigureSuggestions({
    suggestions: minimalSuggestions,
    available: "always",
  });
}
