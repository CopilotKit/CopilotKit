import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      // 1. Controlled Generative UI — frontend-rendered components
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
      // 2a. Fixed-schema A2UI — pre-defined component schemas
      {
        title: "Search Flights (A2UI Fixed Schema)",
        message: "Find flights from SFO to JFK for next Tuesday.",
      },
      // 2b. Dynamic A2UI — agent-generated dashboard UI
      {
        title: "Sales Dashboard (A2UI Dynamic)",
        message:
          "First use the query_data tool to fetch the financial sales data, then using A2UI, show me a sales dashboard with total revenue, new customers, and conversion rate metrics. Include a pie chart of revenue by category and a bar chart of monthly sales.",
      },
      {
        title: "Product Analytics (A2UI Dynamic)",
        message:
          "Using A2UI, create a product analytics view with key metrics (DAU, retention, churn), a pie chart of user segments, and a data table of the top 5 features by usage.",
      },
      // 3. Open Generative UI — MCP apps
      {
        title: "Excalidraw Diagram (Open Generative UI)",
        message:
          "Use Excalidraw to create a simple network diagram showing a router connected to two switches, each connected to two computers.",
      },
      // 4. Human-in-the-Loop
      {
        title: "Schedule Meeting (Human In The Loop)",
        message:
          "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
      },
      // 5. Frontend Tools
      {
        title: "Toggle Dark Mode (Frontend Tools)",
        message: "Switch the app to dark mode using the toggleTheme tool.",
      },
      // 6. Shared State
      {
        title: "Task Manager (Shared State)",
        message:
          "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
      },
    ],
    available: "always",
  });
};
