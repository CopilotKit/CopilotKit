// frontend/src/hooks/useExampleSuggestions.ts
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Pie chart (Controlled Generative UI)",
        message:
          "Please show me the distribution of our revenue by category in a pie chart.",
      },
      {
        title: "Bar chart (Controlled Generative UI)",
        message:
          "Please show me the distribution of our expenses by category in a bar chart.",
      },
      {
        title: "MCP apps (Open Generative UI)",
        message:
          "Please create a simple network diagram of a router and two switches.",
      },
      {
        title: "Change theme (Frontend Tools)",
        message: "Switch the app to dark mode.",
      },
      {
        title: "Scheduling (Human In The Loop)",
        message: "Please schedule a meeting with me to learn about CopilotKit.",
      },
      {
        title: "Canvas (Shared State)",
        message:
          "Please demonstrate shared state, open the canvas, and then add some todos to it about learning about CopilotKit.",
      },
    ],
    available: "always",
  });
};
