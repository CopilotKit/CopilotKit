/**
 * Suggestion pills shown in the chat UI. Each suggestion triggers a specific
 * demo feature when clicked.
 */
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Pie Chart (Controlled Generative UI)",
        message:
          "Show me a pie chart of our revenue distribution by category. Use the query_data tool to fetch the data first, then render it with the pieChart component.",
      },
      {
        title: "Bar Chart (Controlled Generative UI)",
        message:
          "Show me a bar chart of our expenses by category. Use the query_data tool to fetch the data first, then render it with the barChart component.",
      },
      {
        title: "Schedule Meeting (Human In The Loop)",
        message:
          "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
      },
      {
        title: "Toggle Theme (Frontend Tools)",
        message: "Toggle the app theme using the toggleTheme tool.",
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
