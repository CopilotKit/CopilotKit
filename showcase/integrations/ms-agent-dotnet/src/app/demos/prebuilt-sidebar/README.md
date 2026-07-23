# Prebuilt Sidebar

## What This Demo Shows

Using the pre-built `<CopilotSidebar />` component alongside your app's main content. The sidebar is toggled from a launcher button and opens by default here so the form factor is obvious.

## How to Interact

- Click the sidebar launcher to toggle it closed/open
- Ask the assistant anything — it calls the .NET agent backend
- Try the "Say hi" suggestion shown in the chat

## Technical Details

- The demo registers an agent name `prebuilt-sidebar` in `src/app/api/copilotkit/route.ts`. That agent name is simply forwarded to the same .NET `ProverbsAgent` the other demos use — only the frontend chrome differs here.
- `<CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt-sidebar">` wires the provider.
- `<CopilotSidebar agentId="prebuilt-sidebar" defaultOpen={true} />` provides the sidebar chrome.
- `useConfigureSuggestions` adds a static suggestion chip shown inside the sidebar.
