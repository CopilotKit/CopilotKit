import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// The pills ask natural business questions. Which chart to draw is up to the
// agent and the composition rules in the sales context. Each pill maps to a
// different catalog component, so tests/e2e/declarative-gen-ui.spec.ts can
// expect a different component per pill. The messages are also the keys of
// the aimock fixtures, so keep them in sync with the spec and the fixtures.
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
