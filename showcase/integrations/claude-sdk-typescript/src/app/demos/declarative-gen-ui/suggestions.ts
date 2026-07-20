import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Pill prompts are natural business questions — chart-type steering lives in
// the agent's system prompt (src/agent/a2ui-dynamic-prompt.ts) + the demo's
// sales-context.ts composition rules. Each pill maps to a distinct catalog
// component so the D5 probe
// (showcase/harness/src/probes/scripts/d5-gen-ui-declarative.ts) can assert a
// newly-mounted testid per pill. Keep prompts in sync with that probe and with
// tests/e2e/declarative-gen-ui.spec.ts.
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
