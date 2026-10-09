import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useA2uiRecoverySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Recover a bad render",
        message:
          "Build a CrewAI Q2 revenue summary and self-correct a malformed first attempt.",
      },
      {
        title: "Show an unrecoverable failure",
        message:
          "Build a CrewAI report that fails every validation pass so I can preview the fallback.",
      },
    ],
    available: "always",
  });
}
