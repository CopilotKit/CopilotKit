/**
 * Suggestion pill shown in the chat UI.
 *
 * Replaced the multi-pill showcase set with the single canonical e2e pill
 * sourced from showcase/aimock/_canonical-catalog.json so the Phase 2
 * pill-click test has a stable target.
 */
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  // Canonical e2e suggestion (see showcase/aimock/_canonical-catalog.json).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Pasta night",
        message: "suggest a vegetarian pasta dinner for four guests",
      },
    ],
    available: "always",
  });
};
