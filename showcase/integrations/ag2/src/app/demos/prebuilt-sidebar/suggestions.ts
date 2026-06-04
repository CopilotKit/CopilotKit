"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function usePrebuiltSidebarSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Say hi", message: "Say hi!" },
      {
        title: "Fun fact",
        message: "Give me a fun fact.",
      },
      {
        title: "Is 17 prime?",
        message: "Walk me through whether 17 is prime.",
      },
    ],
    available: "always",
  });
}
