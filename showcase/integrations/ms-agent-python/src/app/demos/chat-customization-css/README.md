# Chat Customization (CSS)

## What This Demo Shows

CopilotChat re-themed via `CopilotKitCSSProperties` CSS variables plus targeted overrides of built-in class names.

## How to Interact

Send any message. The user bubble, assistant bubble, input area, and background are all re-themed (hot pink + amber serif/mono).

## Technical Details

- All theme rules live in `theme.css` and are scoped to the `.chat-css-demo-scope` wrapper so they do not leak to the rest of the app.
- `--copilot-kit-*` CSS variables drive accent colors at the root scope.
- Built-in class names (`copilotKitInput`, `copilotKitUserMessage`, `copilotKitAssistantMessage`, etc.) are overridden directly where CSS variables aren't enough.
- See the [customize built-in UI components guide](https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components) for the full list of class hooks.
