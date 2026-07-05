"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Suggestion `message` strings double as deterministic aimock fixture keys.
// Keep them short, distinctive, and aligned with the first-call `render_insight`
// fixture entries so each pill click produces a stable tool call rather than
// getting absorbed by a generic catch-all fixture.
export function useOpenGenUiSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Renewable energy mix",
        message: "Visualize the global renewable energy mix.",
      },
      {
        title: "Web vitals report",
        message: "Show an insight card for my site's Core Web Vitals.",
      },
      {
        title: "Team velocity",
        message: "Break down our sprint team velocity metrics.",
      },
    ],
    available: "always",
  });
}
