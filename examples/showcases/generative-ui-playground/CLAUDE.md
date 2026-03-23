# A2UI Playground

Next.js demo: **A2UI** (declarative JSON UI) with CopilotKit, backed by the Python **A2A** agent (`a2a-agent`).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js)                                                  │
│  ├── CopilotKitProvider → /api/copilotkit-a2ui                      │
│  ├── renderActivityMessages: A2UIRenderer                           │
│  └── CopilotSidebar / CopilotPopup                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  A2AAgent (@ag-ui/a2a) → Python A2A server (port 10002)              │
│  LangGraph + ChatOpenAI generates A2UI JSON                          │
└─────────────────────────────────────────────────────────────────────┘
```

## A2UI (Agent-to-UI)

Agent-composed declarative JSON UI, rendered dynamically.

- Python agent (LangGraph + ChatOpenAI) generates A2UI JSON at runtime
- General-purpose UI generator: forms, lists, cards, confirmations
- A2UIRenderer processes activity messages
- **Files**: `a2a-agent/agent/*.py`, `src/app/components/A2UIPage.tsx`, `src/app/theme.ts`

## Widget Builder

The "Widget Builder" link in the header opens the official A2UI Composer at https://a2ui-composer.ag-ui.com/.

## npm

- **`legacy-peer-deps`**: Root `.npmrc` sets `legacy-peer-deps=true` so `npm install` works without flags when peer ranges conflict.

## Development

### Start Services

```bash
# Terminal 1: Python A2A Agent
cd a2a-agent && python -m agent

# Terminal 2: Next.js Frontend
npm run dev
```

### URLs

- Frontend: http://localhost:3000
- A2A Agent: http://localhost:10002

## Environment Variables

```bash
# Keys for the Python A2A agent (see a2a-agent/CLAUDE.md)
DASHSCOPE_API_KEY=sk-...
# QWEN_LITELLM_MODEL=dashscope/qwen-plus

# or
OPENAI_API_KEY=sk-...

A2A_AGENT_URL=http://localhost:10002   # Next.js API route → Python agent
```

## Production URLs (Railway)

Live deployment on Railway (project `ui-protocols-demo`):

- **Frontend**: https://frontend-production-456e.up.railway.app
- **A2A Agent**: https://a2a-agent-production.up.railway.app

## Key Packages

```json
{
  "@copilotkit/a2ui-renderer": "A2UI message renderer",
  "@copilotkitnext/react": "CopilotKitProvider, sidebar, popup",
  "@copilotkitnext/runtime": "CopilotRuntime backend",
  "@ag-ui/a2a": "A2AAgent",
  "@a2a-js/sdk": "A2A client"
}
```

## File Structure

```
ui-protocols-demo/
├── src/app/
│   ├── page.tsx                 # Landing + A2UI protocol card + prompts
│   ├── theme.ts                 # A2UI v0.8 theme
│   ├── api/
│   │   └── copilotkit-a2ui/     # CopilotRuntime + A2AAgent
│   └── components/
│       ├── A2UIPage.tsx         # Provider + A2UIRenderer + chat shell
│       ├── protocol-cards/      # A2UICard
│       └── PromptPill.tsx
└── a2a-agent/                   # Python A2A agent
```

## Hooks

### useSendMessage

Custom hook for programmatically sending messages to the chat. Used by PromptPill and protocol card pills.

```tsx
import { useSendMessage } from "./hooks/useSendMessage";

function MyComponent() {
  const { sendMessage } = useSendMessage();

  return (
    <button onClick={() => sendMessage("Create a contact form with email and phone")}>
      Open form demo
    </button>
  );
}
```

Located at `src/app/hooks/useSendMessage.ts`.

## Styling Notes

### CopilotKit Banner

To disable the "CopilotKit v1.50 is now live!" announcement banner, set `showDevConsole={false}` on CopilotKitProvider (see `A2UIPage.tsx`).

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
