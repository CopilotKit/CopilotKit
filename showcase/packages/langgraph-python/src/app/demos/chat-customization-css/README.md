# Chat Customization (CSS)

## What This Demo Shows

How to restyle `CopilotChat` entirely through CSS — no slot overrides, no component swaps — by targeting CopilotKit's documented CSS variables and built-in class names.

- **CSS variable overrides**: `--copilot-kit-primary-color`, `--copilot-kit-background-color`, and friends set the accent palette
- **Class-targeted styling**: `copilotKitMessages`, `copilotKitUserMessage`, `copilotKitAssistantMessage`, and `copilotKitInput` get bespoke fonts, colors, borders, and shadows
- **Scoped theme**: every selector is namespaced under `.chat-css-demo-scope` so the styling does not leak into the rest of the app

## How to Interact

Type any prompt. For example:

- "Say hi"
- "Write a short poem about pink and yellow"
- "Tell me something interesting"

Watch the hot-pink user bubbles, amber serif/mono assistant bubbles, and dashed-pink input frame — all pure CSS.

## Technical Details

- `CopilotKit` wires the page with `runtimeUrl="/api/copilotkit"` and `agent="chat-customization-css"`, backed by the default `graph` in `src/agents/main.py`
- `CopilotChat` is rendered inside a `<div className="chat-css-demo-scope">` wrapper and the theme is applied by `import "./theme.css"` at the top of the page
- `theme.css` targets the class names documented at [customize-built-in-ui-components](https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components) — override the variables for quick accent changes, or style the classes directly for full control
- Use CSS when the default component structure works and you just want a different look; reach for slots (see `chat-slots`) when you need to change what a piece actually renders
