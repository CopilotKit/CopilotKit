import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export function useDeclarativeGenUISuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show a KPI dashboard",
        message: "Show me my sales dashboard for this quarter.",
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
        title: "Accounts at risk",
        message: "Are any accounts or pipeline deals at risk this quarter?",
      },
    ],
    available: "always",
  });
}
