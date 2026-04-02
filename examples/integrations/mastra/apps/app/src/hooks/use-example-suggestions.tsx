import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      // 1. Controlled Generative UI — charts rendered by frontend components
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
      // 2. Human-in-the-Loop — frontend tool that requires user decision
      {
        title: "Schedule Meeting (Human In The Loop)",
        message:
          "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
      },
      // 3. Declarative UI (A2UI) — agent returns structured UI components
      {
        title: "Event Registration (Declarative UI)",
        message:
          "Generate an event registration form using the generate_form tool.",
      },
      // 4. Open Generative UI — MCP app renders its own UI
      {
        title: "Excalidraw Diagram (Open Generative UI)",
        message:
          "Use Excalidraw to create a simple network diagram showing a router connected to two switches, each connected to two computers.",
      },
      // 5. Frontend Tools — direct frontend state manipulation
      {
        title: "Toggle Dark Mode (Frontend Tools)",
        message: "Switch the app to dark mode using the toggleTheme tool.",
      },
    ],
    available: "always",
  });
};
