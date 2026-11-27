"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function usePrebuiltPopupSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Say hi", message: "Say hi from the popup!" },
      {
        title: "Limerick",
        message: "Write me a quick limerick.",
      },
      {
        title: "Is 17 prime?",
        message: "Walk me through whether 17 is prime.",
      },
    ],
    available: "always",
  });
}
