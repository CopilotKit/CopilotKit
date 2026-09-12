"use client";

import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Sales bar chart",
        message: "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.",
      },
      {
        title: "Traffic pie chart",
        message: "Show me a pie chart of website traffic by source.",
      },
      {
        title: "Market share",
        message: "Show a pie chart of smartphone market share by brand.",
      },
    ],
    available: "always",
  });
}
