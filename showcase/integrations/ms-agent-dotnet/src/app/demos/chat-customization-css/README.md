# Chat Customization (CSS)

## What This Demo Shows

A full visual re-skin of `<CopilotChat />` accomplished entirely through CSS — no slot overrides, no custom React components. All theming lives in `theme.css` and is scoped to a wrapper class so it cannot leak out to the rest of the showcase app.

## How to Interact

- Send a message and notice the serif user bubbles (hot pink, gradient) and the monospace amber assistant replies
- Focus the input to see the dashed hot-pink border
- Resize the window — the scoped theme is self-contained

## Technical Details

- `theme.css` targets CopilotKit's built-in `copilotKit*` class hooks and overrides the `--copilot-kit-*` CSS variables.
- Every selector is prefixed with `.chat-css-demo-scope`; removing that class on the wrapper would instantly revert the chat to the stock look.
- The page imports `./theme.css` directly rather than adding it to `globals.css` — Tailwind v4 does not purge CSS files imported from component modules.
- The agent name `chat-customization-css` is registered in `src/app/api/copilotkit/route.ts` and forwards to the shared .NET `ProverbsAgent`.

See also: https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components
