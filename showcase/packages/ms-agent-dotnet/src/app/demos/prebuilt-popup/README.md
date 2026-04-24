# Prebuilt Popup

## What This Demo Shows

Using the pre-built `<CopilotPopup />` component — a floating launcher bubble in the corner that opens an overlay chat window on top of the page content.

## How to Interact

- The popup is open by default; click the launcher bubble to toggle it
- Try the "Say hi" suggestion or type your own message
- Messages flow to the same .NET agent the other demos use

## Technical Details

- `<CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt-popup">` wires the provider to the runtime.
- `<CopilotPopup agentId="prebuilt-popup" defaultOpen={true} ... />` provides the floating launcher plus overlay chat.
- `labels.chatInputPlaceholder` shows how to customize built-in strings without writing a full theme.
- `useConfigureSuggestions` adds a static suggestion chip.
- The agent name `prebuilt-popup` is registered in `src/app/api/copilotkit/route.ts` and forwards to the shared .NET `ProverbsAgent`.
