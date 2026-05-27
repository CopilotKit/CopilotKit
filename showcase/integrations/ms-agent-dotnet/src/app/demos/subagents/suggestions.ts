"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSubagentsSuggestions(isRunning: boolean) {
  useConfigureSuggestions(
    {
      suggestions: [
        {
          title: "Write a blog post",
          message:
            "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique.",
          isLoading: isRunning,
        },
        {
          title: "Explain a topic",
          message:
            "Explain how large language models handle tool calling. Research, write a paragraph, then critique.",
          isLoading: isRunning,
        },
        {
          title: "Summarize a topic",
          message:
            "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique.",
          isLoading: isRunning,
        },
      ],
      consumerAgentId: "subagents",
      available: "always",
    },
    [isRunning],
  );
}
