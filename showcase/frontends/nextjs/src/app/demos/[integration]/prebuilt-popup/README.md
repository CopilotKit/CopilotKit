# Prebuilt Popup

## What This Demo Shows

The prebuilt `<CopilotPopup />` component: a launcher bubble in the corner opens a chat window on top of the page.

- **Floating launcher**: the bubble stays in the corner and opens or closes the chat window.
- **Open at load**: the popup starts open, so the form factor is easy to see.
- **Custom placeholder**: the `labels` prop changes the placeholder text of the input.
- **Suggestions**: three starter prompts show as chips.

## How to Interact

- Click the launcher bubble to close or open the popup.
- Click a suggestion chip, or type your own message. For example: "Say hi from the popup!"

## Technical Details

- `<CopilotKit runtimeUrl={useDemoRuntimeUrl("prebuilt-popup")} agent="prebuilt-popup">` connects the page to the runtime at `/api/<integration>/prebuilt-popup`.
- `<CopilotPopup agentId="prebuilt-popup" defaultOpen={true} ... />` renders the launcher and the chat window.
- `labels.chatInputPlaceholder` changes a built-in string without a full theme.
- `useConfigureSuggestions` registers the static suggestions.
- The `prebuilt-sidebar` demo shows the same chat docked to the side of the page.
