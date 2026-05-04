# UI Protocols Demo

Generative UI playground showcasing three protocols for AI-powered interfaces.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js)                                                  │
│  ├── Protocol tabs: [Static+MCP] [A2UI]                             │
│  ├── CopilotKitProvider with agent switching                        │
│  ├── renderActivityMessages: A2UIRenderer (a2ui mode only)          │
│  ├── useRenderToolCall: WeatherCard, StockCard                      │
│  ├── useHumanInTheLoop: TaskApprovalCard                            │
│  └── CopilotSidebar                                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│ "default" Agent         │     │ "a2ui" Agent            │
│ BasicAgent + MCP Apps   │     │ HttpAgent → Python A2A  │
│ Port: 3001 (MCP)        │     │ Port: 10002             │
└─────────────────────────┘     └─────────────────────────┘
```

## Three Protocols

### 1. Static GenUI

Pre-built React components rendered by frontend hooks.

- **useRenderToolCall**: Display-only rendering (WeatherCard, StockCard)
- **useHumanInTheLoop**: Interactive approval (TaskApprovalCard)
- **Files**: `src/app/components/static-tools/*.tsx`

### 2. MCP Apps

HTML/JS apps served by MCP server, rendered as sandboxed iframes.

- 6 apps: Flights, Hotels, Trading, Kanban, Calculator, Todo
- MCP server registers tools with UI resources (`mimeType: "text/html+mcp"`)
- MCPAppsMiddleware bridges MCP to AG-UI events
- **CRITICAL**: Requires `public/sandbox.html` — the iframe sandbox page that MCPAppsActivityRenderer loads app content into. Without it, iframes show 404.
- **Files**: `mcp-server/apps/*.html`, `mcp-server/server.ts`, `public/sandbox.html`

### 3. A2UI (Agent-to-UI)

Agent-composed declarative JSON UI, rendered dynamically.

- Python agent (Google ADK) generates A2UI JSON at runtime
- General-purpose UI generator: forms, lists, cards, confirmations
- No external data dependencies - generates UI from user descriptions
- A2UIRenderer processes activity messages
- **Files**: `a2a-agent/agent/*.py`

## Widget Builder

The "Widget Builder" link in the header opens the official A2UI Composer at https://a2ui-composer.ag-ui.com/.

## Development

### Start All Services

```bash
# Terminal 1: MCP Server
cd mcp-server && npm run dev

# Terminal 2: Python A2A Agent
cd a2a-agent && python -m agent

# Terminal 3: Next.js Frontend
npm run dev
```

### URLs

- Frontend: http://localhost:3000
- MCP Server: http://localhost:3001/mcp
- A2A Agent: http://localhost:10002

## Environment Variables

```bash
# .env
OPENAI_API_KEY=sk-...          # OpenAI API key for gpt-5.2
MCP_SERVER_URL=http://localhost:3001/mcp
A2A_AGENT_URL=http://localhost:10002
```

## Production URLs (Railway)

Live deployment on Railway:

- **Frontend**: https://frontend-production-456e.up.railway.app
- **MCP Server**: https://mcp-server-production-5419.up.railway.app
- **A2A Agent**: https://a2a-agent-production.up.railway.app

Railway Project: `ui-protocols-demo`

## Key Packages

```json
{
  "@copilotkit/react-core": "Frontend provider and hooks",
  "@copilotkit/react-ui": "CopilotSidebar component",
  "@copilotkit/a2ui-renderer": "A2UI message renderer",
  "@copilotkit/runtime": "CopilotRuntime backend",
  "@copilotkit/runtime/v2": "BasicAgent class",
  "@ag-ui/mcp-apps-middleware": "MCP Apps → AG-UI bridge"
}
```

## File Structure

```
ui-protocols-demo/
├── src/app/
│   ├── page.tsx                 # Main page with agent switching
│   ├── theme.ts                 # A2UI v0.8 theme
│   ├── api/
│   │   ├── copilotkit/          # CopilotRuntime API route (default agent)
│   │   └── copilotkit-a2ui/     # CopilotRuntime API route (A2UI agent)
│   └── components/
│       ├── CopilotContextProvider.tsx   # Static tool hooks
│       ├── static-tools/        # Weather, Stock, TaskApproval cards
│       ├── protocol-cards/      # Educational protocol cards
│       ├── ComparisonTable.tsx  # Protocol comparison
│       └── PromptPill.tsx       # Clickable suggestion pills
├── mcp-server/                  # MCP Apps server (see mcp-server/CLAUDE.md)
└── a2a-agent/                   # Python A2A agent (see a2a-agent/CLAUDE.md)
```

## Agent Switching

Frontend uses `useState` to toggle between agents:

- `"default"`: Static GenUI + MCP Apps (BasicAgent + MCPAppsMiddleware)
- `"a2ui"`: General-purpose UI generator (HttpAgent → Python A2A backend)

The `agent` prop on CopilotKitProvider determines which backend agent handles requests.

### Pending Message Pattern

Protocol card pills can trigger automatic mode switches. When clicking a pill for a different mode than currently active, the app:

1. Sets `pendingMessage` state in `Home` component (outside provider)
2. Switches `activeAgent` state, triggering provider remount
3. `PageContent` (inside provider) has `useEffect` that watches `pendingMessage`
4. After remount, `useEffect` sends the message and clears state

This pattern handles the challenge that `useSendMessage` hook only works inside provider context, but mode switching causes a full provider remount.

```tsx
// In Home (outside provider)
const handlePillClick = (prompt: string, targetMode: "default" | "a2ui") => {
  setPendingMessage(prompt);
  if (targetMode !== activeAgent) {
    setActiveAgent(targetMode);
  }
};

// In PageContent (inside provider)
useEffect(() => {
  if (pendingMessage) {
    // 100ms delay ensures CopilotKit context is fully initialized after remount
    const timer = setTimeout(() => {
      sendMessage(pendingMessage);
      clearPendingMessage();
    }, 100);
    return () => clearTimeout(timer);
  }
}, [pendingMessage, sendMessage, clearPendingMessage]);
```

**Note:** The 100ms delay is necessary because `useSendMessage` depends on `useAgent` and `useCopilotKit` hooks which need time to initialize after provider remount. A 0ms timeout is not sufficient.

## Hooks

### useSendMessage

Custom hook for programmatically sending messages to the chat. Used by PromptPill and protocol card pills.

```tsx
import { useSendMessage } from "./hooks/useSendMessage";

function MyComponent() {
  const { sendMessage } = useSendMessage();

  return (
    <button onClick={() => sendMessage("What's the weather in Tokyo?")}>
      Ask about weather
    </button>
  );
}
```

Located at `src/app/hooks/useSendMessage.ts`.

## Styling Notes

### CopilotKit Banner

To disable the "CopilotKit v1.50 is now live!" announcement banner, set `showDevConsole={false}` on CopilotKitProvider. This must be set on both providers (default mode in `page.tsx` and A2UI mode in `A2UIPage.tsx`).

### Chat Padding Override

CopilotKit's sidebar chat has hardcoded 32px horizontal padding via Tailwind class `[div[data-sidebar-chat]_&]:px-8`. To override:

```css
div[data-sidebar-chat] > div > div {
  padding-left: 8px !important;
  padding-right: 8px !important;
}
```

### Content Centering with Sidebar

When using a fixed-position 400px sidebar, apply `paddingRight: '400px'` to the flex **container** (not the child). This ensures `mx-auto` centers content relative to the visible viewport:

```tsx
<div className="flex min-h-screen" style={{ paddingRight: "400px" }}>
  <div className="flex-1">
    <div className="max-w-3xl mx-auto">...</div>
  </div>
</div>
```

### A2UI Button Text Color

A2UI uses Lit web components with shadow DOM. Button text is rendered inside nested `<a2ui-text>` elements that use `<p>` tags with `color-c-n30` class.

**Required**: Import `a2ui-theme.css` in layout.tsx - this defines the CSS custom properties (`--n-100: #ffffff`, `--n-30: #474747`, etc.) that A2UI components need.

**Theme additionalStyles** override button text color:

```typescript
additionalStyles: {
  Button: {
    "--n-35": "var(--n-100)",  // Ensures hover state also uses white text
    "--n-30": "var(--n-100)",  // Override text color inside button to white
  },
}
```

**Why `--n-30`?** A2UI buttons render labels via `<a2ui-text>` → `<p class="color-c-n30">`. The `color-c-n30` class references `--n-30` CSS variable. Setting it to `var(--n-100)` (white) makes button text readable on the lilac background.

**Note:** A2UI agents cannot write their own styles. The @a2ui/lit renderer intentionally ignores `beginRendering.styles.font` and `beginRendering.styles.primaryColor` to prevent agent styles from overriding app-level themes. All A2UI styling is controlled via the theme object passed to `createA2UIMessageRenderer`.
