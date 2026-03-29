import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Sales Dashboard",
        message:
          "Show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
      },
      {
        title: "Team Performance",
        message:
          "Generate a team performance dashboard showing each team member's completed tasks, satisfaction score, and a bar chart comparing their output this quarter.",
      },
      {
        title: "Product Analytics",
        message:
          "Create a product analytics view with key metrics (DAU, retention, churn), a pie chart of user segments, and a data table of the top 5 features by usage.",
      },
      {
        title: "Schedule Meeting (Human In The Loop)",
        message:
          "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
      },
      {
        title: "Toggle Dark Mode (Frontend Tools)",
        message: "Switch the app to dark mode using the toggleTheme tool.",
      },
      {
        title: "Task Manager (Shared State)",
        message:
          "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
      },
    ],
    available: "always",
  });
};
