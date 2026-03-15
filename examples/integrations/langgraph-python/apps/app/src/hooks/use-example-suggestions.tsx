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
      // 3b. Fixed Schema A2UI — data-bound declarative UI with flight cards
      {
        title: "Flight Search (Fixed Schema A2UI)",
        message:
          "Search for flights using the search_flights tool. Show 4 options with diverse routes (e.g. LAX→ORD, SFO→JFK, DEN→ATL, SEA→MIA) and different airlines and times.",
      },
      // 3c. Streaming A2UI — schema emitted at tool start, data streams in progressively
      {
        title: "Flight Search Streaming (A2UI Streaming)",
        message:
          "Search for flights from LAX to ORD using the search_flights_streaming tool. Show 3 options with different airlines and times.",
      },
      // 3d. Dynamic Schema A2UI — LLM generates the entire UI spec from scratch
      {
        title: "User Profile Card (Dynamic A2UI)",
        message:
          "Use the generate_a2ui tool to create a user profile card for a fictional person. Include an avatar image, name, bio, and stats (followers, posts).",
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
      // 6. Shared State — agent manipulates application state
      {
        title: "Task Manager (Shared State)",
        message:
          "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
      },
    ],
    available: "always",
  });
};
