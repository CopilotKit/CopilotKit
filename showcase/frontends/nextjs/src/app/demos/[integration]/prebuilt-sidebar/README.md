# Prebuilt Sidebar

## What This Demo Shows

The prebuilt `<CopilotSidebar />` component: a chat panel docked to the side of the page, next to the main content.

- **Docked panel**: one component renders the full chat UI beside the page.
- **Open at load**: the sidebar starts open, so the form factor is easy to see.
- **Launcher**: a button opens the sidebar again after you close it.
- **Suggestions**: three starter prompts show as chips in the sidebar.

## How to Interact

- Close the sidebar with its close button. Open it again with the launcher.
- Click a suggestion chip, or type your own message. For example: "Say hi!"

## Technical Details

- `<CopilotKit runtimeUrl={useDemoRuntimeUrl("prebuilt-sidebar")} agent="prebuilt-sidebar">` connects the page to the runtime at `/api/<integration>/prebuilt-sidebar`.
- `<CopilotSidebar agentId="prebuilt-sidebar" defaultOpen={true} />` renders the sidebar.
- `useConfigureSuggestions` registers the static suggestions.
- The `prebuilt-popup` demo shows the same chat in a floating window.
