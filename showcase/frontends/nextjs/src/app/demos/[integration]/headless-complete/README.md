# Headless Chat (Complete)

## What This Demo Shows

A full chat UI built by hand on `useAgent`, with no `<CopilotChat />`. Each render surface of CopilotKit comes from a low-level hook. You can see where each layer lives, and replace any of them with your own UI.

- **Tool cards**: `useRenderTool` renders the weather, stock and chart cards. `useDefaultRenderTool` renders a generic card for every other tool.
- **Frontend tool**: `useComponent` registers `highlight_note`, which renders a sticky note.
- **MCP Apps**: `useRenderActivityMessage` renders the UI of an MCP server tool (the Excalidraw iframe).
- **Suggestions**: `useConfigureSuggestions` registers four prompts, and `useSuggestions` shows them above the composer.
- **Attachments**: `useAttachments` adds images and PDFs to a message, as inline base64.

## How to Interact

Click a sample prompt in the empty state, or type your own message. For example:

- "What's the weather in Tokyo?"
- "What's AAPL trading at?"
- "Highlight: ship the demo on Friday"
- "Show me a chart of revenue over the last six months"

To attach an image or a PDF, click the paperclip button, or drop the file on the composer.

## Technical Details

### Files

- `page.tsx`: the provider, and one hook call for each render surface.
- `chat/`: the chat shell. `chat.tsx` sends messages and resets the chat. `message-list.tsx` gives each message to its renderer.
- `hooks/`: the renderer registrations, the suggestions, auto-scroll and the typing indicator.
- `tools/`: the cards that the tool renderers return.
- `attachments/`: the `useAttachments` setup and the attachment chip.

### Runtime

- `useDemoRuntimeUrl("headless-complete")` gives the runtime URL, `/api/<integration>/headless-complete`.
- The runtime options of this demo turn on MCP Apps (see `src/demo-runtime-options.ts`). The default server is the public Excalidraw MCP app. `MCP_SERVER_URL` sets another server.
- The page sends each run with `copilotkit.runAgent({ agent })`. This call sends the frontend tools (`highlight_note`) and the context with the run. `agent.runAgent()` does not send them.
- The backend tools `get_weather`, `get_stock_price` and `get_revenue_chart` get their own cards. Each other tool gets the generic card.
