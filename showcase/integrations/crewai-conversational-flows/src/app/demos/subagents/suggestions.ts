"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSubagentsSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Write a blog post",
        message:
          "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique.",
      },
      {
        title: "Explain a topic",
        message:
          "Explain how large language models handle tool calling. Research, write a paragraph, then critique.",
      },
      {
        title: "Summarize a topic",
        message:
          "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique.",
      },
    ],
    available: "always",
  });
}
