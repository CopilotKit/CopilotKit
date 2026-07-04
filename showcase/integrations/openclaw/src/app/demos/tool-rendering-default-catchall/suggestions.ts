"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Read a file",
        message: "Show me the contents of package.json.",
      },
      {
        title: "List files",
        message: "List the files in the current directory.",
      },
    ],
    available: "always",
  });
}
