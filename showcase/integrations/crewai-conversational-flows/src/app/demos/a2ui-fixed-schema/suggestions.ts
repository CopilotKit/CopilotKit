import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useA2UIFixedSchemaSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Find SFO → JFK",
        message: "Find me a flight from SFO to JFK on United for $289.",
      },
    ],
    available: "always",
  });
}
