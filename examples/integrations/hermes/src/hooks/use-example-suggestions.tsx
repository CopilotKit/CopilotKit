/**
 * Suggestion pills shown in the chat UI. Each triggers a demo feature when
 * clicked.
 *
 * Scoped to what a generic Hermes agent supports out of the box, so these work
 * with any `hermes agui` server — no server-side demo tools required.
 * `toggleTheme` and `scheduleTime` are frontend tools (declared by the client
 * and forwarded to the agent by the AG-UI adapter); the Calculator instead uses
 * the runtime's open-generative-UI feature (`generateSandboxedUi`, enabled by
 * `openGenerativeUI` in the API route). The canonical showcase's server-tool
 * demos (charts via `query_data`, flight search, todos, A2UI dashboards) are
 * intentionally not here; a plain Hermes agent doesn't have those tools.
 */
import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Toggle Theme (Frontend Tools)",
        message: "Toggle the app theme using the toggleTheme tool.",
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
    ],
    available: "always",
  });
};
