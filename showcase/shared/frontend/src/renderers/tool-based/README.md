# Tool-Based Renderer

The tool-based renderer is the default rendering strategy. The agent calls typed tool
functions (pieChart, barChart, scheduleTime, toggleTheme) that are registered on the
frontend via `useShowcaseHooks()`. Each tool invocation renders a pre-built React
component directly in the chat sidebar.

## How it works

1. `useShowcaseHooks()` registers frontend tools and controlled generative UI components
   (pie charts, bar charts, meeting time picker, theme toggle).
2. `useShowcaseSuggestions()` provides contextual chat suggestions.
3. The `SalesDashboard` displays the pipeline view, driven by agent state.
4. `CopilotSidebar` hosts the chat interface where tool outputs appear inline.

## When to use

Use this renderer when you want deterministic, type-safe UI rendering where the agent
selects from a fixed set of pre-built components. This gives the highest constraint
level -- the agent cannot produce arbitrary UI, only invoke registered tools.
