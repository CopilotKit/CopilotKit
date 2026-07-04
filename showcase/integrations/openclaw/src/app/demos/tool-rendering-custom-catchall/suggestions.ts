"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "List files",
        message: "List the files in the current directory.",
      },
      {
        title: "Read a file",
        message: "Show me the contents of package.json.",
      },
      {
        title: "System info",
        message: "What operating system are you running on?",
      },
      {
        title: "Chain tools",
        message:
          "Chain a few tools in this single turn: list the files here, then read the first one you find.",
      },
    ],
    available: "always",
  });
}
