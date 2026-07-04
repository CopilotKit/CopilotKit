"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useReadonlyStateAgentContextSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Who am I?",
        message: "What is my name according to my context?",
      },
      {
        title: "What timezone am I in?",
        message: "What timezone am I in?",
      },
      {
        title: "Summarize my activity",
        message: "Summarize my recent activity.",
      },
    ],
    available: "always",
  });
}
