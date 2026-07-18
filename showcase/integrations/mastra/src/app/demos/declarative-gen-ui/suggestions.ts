import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Pill prompts are natural business questions — chart-type steering lives in
// the agent's system prompt. Each pill maps to a distinct catalog component so
// the D5 probe (showcase/harness/src/probes/scripts/d5-gen-ui-declarative.ts)
// can assert a newly-mounted testid per pill. Keep prompts in sync with that
// probe.
export function useDeclarativeGenUISuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show my sales dashboard",
        message: "Show me my sales dashboard for this quarter.",
      },
      {
        title: "Team performance",
        message: "How are our sales reps performing against quota?",
      },
      {
        title: "Anything at risk?",
        message: "Are any accounts or pipeline deals at risk this quarter?",
      },
      {
        title: "Top account details",
        message: "Pull up the details on our biggest account.",
      },
    ],
    available: "always",
  });
}
