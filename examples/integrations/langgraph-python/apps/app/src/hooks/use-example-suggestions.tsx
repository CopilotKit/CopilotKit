import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      // A2UI — dynamic dashboard generation
      {
        title: "Sales Dashboard (A2UI)",
        message:
          "Show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
      },
      {
        title: "Product Analytics (A2UI)",
        message:
          "Create a product analytics view with key metrics (DAU, retention, churn), a pie chart of user segments, and a data table of the top 5 features by usage.",
      },
      // Controlled Generative UI — frontend-rendered charts
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
      // Human-in-the-Loop
      {
        title: "Schedule Meeting (Human In The Loop)",
        message:
          "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
      },
      // MCP Apps — Open Generative UI
      {
        title: "Excalidraw Diagram (Open Generative UI)",
        message:
          "Use Excalidraw to create a simple network diagram showing a router connected to two switches, each connected to two computers.",
      },
      // Frontend Tools
      {
        title: "Toggle Dark Mode (Frontend Tools)",
        message: "Switch the app to dark mode using the toggleTheme tool.",
      },
      // Shared State
      {
        title: "Task Manager (Shared State)",
        message:
          "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
      },
    ],
    available: "always",
  });
};
