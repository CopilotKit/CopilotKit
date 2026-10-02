import {
  useConfigureSuggestions,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";

/**
 * Cowork (LangGraph) suggestions — kanban-board workflow.
 *
 * Exported (alongside DASHBOARD_SUGGESTIONS) so ChatWired's input intercept
 * can route a manually-typed chip message through the same
 * `handleSelectSuggestion` handler that a click would — without that, the
 * hardcoded ADK chips fall through to aimock's catch-all and the demo
 * looks broken when the user types instead of clicks.
 */
export const COWORK_SUGGESTIONS = [
  {
    title: "Plan next sprint",
    message: "Plan the next sprint using these meeting notes",
  },
  {
    title: "Analyze backlog",
    message: "Analyze the backlog and tell me what's blocking ship.",
  },
  {
    title: "Show me urgent issues",
    message: "Show me all the urgent issues right now.",
  },
  {
    title: "Move ISS-101 to Done",
    message: "Move ISS-101 to Done.",
  },
  {
    title: "Sketch the checkout redesign",
    message:
      "Sketch a guest-checkout flow with an upsell modal for our checkout redesign.",
  },
  {
    title: "Bar chart by status",
    message: "Show me a bar chart of issue counts by status.",
  },
  {
    title: "Toggle theme",
    message: "Toggle the app theme.",
  },
] as const;

/**
 * Dashboard Designer (ADK) suggestions — drive the stats dashboard via the
 * `updateDashboard` frontend tool. Each message reads like a real question
 * the user would ask; the agent picks the right filter and focus copy from
 * the tool description (see useGenerativeUIExamples.tsx).
 */
// Titles must match the keys in HARDCODED_DASHBOARD_RESPONSES (App.tsx);
// the suggestion-click interceptor dispatches on title. Messages read like
// natural user utterances per the suggestion-chip convention (see
// feedback_suggestion_chips memory note).
export const DASHBOARD_SUGGESTIONS = [
  {
    title: "Build the dashboard",
    message: "Build me a dashboard from the current backlog.",
  },
  {
    title: "Sarah's workload",
    message: "Show me everything Sarah is working on.",
  },
  {
    title: "Urgent right now",
    message: "What's the most urgent right now?",
  },
  {
    title: "Who has the most work?",
    message: "Who has the most work right now?",
  },
  {
    title: "What's in flight?",
    message: "Show me everything currently in progress.",
  },
  {
    title: "Reset the dashboard",
    message: "Reset the filter and show me the full backlog.",
  },
] as const;

export const useExampleSuggestions = () => {
  const config = useCopilotChatConfiguration();
  const isDashboard = config?.agentId === "adk";

  useConfigureSuggestions({
    suggestions: isDashboard
      ? [...DASHBOARD_SUGGESTIONS]
      : [...COWORK_SUGGESTIONS],
    available: "always",
  });
};
