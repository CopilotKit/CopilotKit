import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useDeclarativeGenUISuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show a KPI dashboard",
        message:
          "Show me a quick KPI dashboard with 3-4 metrics (revenue, signups, churn).",
      },
      {
        title: "Pie chart — sales by region",
        message: "Show a pie chart of sales by region.",
      },
      {
        title: "Bar chart — quarterly revenue",
        message: "Render a bar chart of quarterly revenue.",
      },
      {
        title: "Status report",
        message:
          "Give me a status report on system health — API, database, and background workers.",
      },
    ],
    available: "always",
  });
}
