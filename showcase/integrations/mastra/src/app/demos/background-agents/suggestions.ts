import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useBackgroundAgentsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Research AI agent frameworks",
        message:
          "Kick off deep research on the current landscape of AI agent frameworks.",
      },
      {
        title: "Investigate renewable energy trends",
        message:
          "Kick off deep research on emerging renewable energy trends for 2026.",
      },
    ],
    available: "always",
  });
}
