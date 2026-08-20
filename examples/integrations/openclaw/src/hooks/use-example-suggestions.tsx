/**
 * Suggestion pills shown in the chat UI. Kept to the frontend-tool demos that
 * work against a generic OpenClaw gateway (clawg-ui fork): controlled
 * generative UI (charts), human-in-the-loop (meeting picker), open generative
 * UI, and a frontend tool (theme). The model supplies the chart data inline —
 * there is no bundled backend data tool in this demo.
 */
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Pie Chart (Controlled Generative UI)",
        message:
          "Show me a pie chart of this revenue split — Product A 45%, Product B 30%, Product C 25% — using the pieChart component.",
      },
      {
        title: "Bar Chart (Controlled Generative UI)",
        message:
          "Show me a bar chart of these monthly expenses — Jan 12k, Feb 9k, Mar 15k — using the barChart component.",
      },
      {
        title: "Schedule Meeting (Human In The Loop)",
        message:
          "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
      },
      {
        title: "Calculator App (Open Generative UI)",
        message:
          "Using the generateSandboxedUi tool, build a modern calculator with standard buttons.",
      },
      {
        title: "Toggle Theme (Frontend Tools)",
        message: "Toggle the app theme using the toggleTheme tool.",
      },
    ],
    available: "always",
  });
};
