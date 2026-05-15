# Beautiful Chat (Simplified — AG2)

## What This Demo Shows

A simplified port of the langgraph-python `beautiful-chat` flagship cell.
The canonical reference combines THREE big features on a single runtime
(A2UI Dynamic + Open Generative UI + MCP Apps); the AG2 port ships the
first two together in a single cell so you can see them coexist:

- **A2UI Dynamic Schema** — the agent calls `generate_a2ui` to render
  branded compositions from a registered React catalog (Card,
  StatusBadge, Metric, InfoRow, PieChart, BarChart, plus the basic A2UI
  primitives).
- **Open Generative UI** — the runtime auto-injects
  `generateSandboxedUi` as a frontend tool, and the agent picks it for
  free-form visuals the catalog cannot express (educational
  illustrations, algorithm walkthroughs, animations).

MCP Apps is NOT bundled here — see `/demos/mcp-apps` for a dedicated
MCP cell. Keeping MCP separate keeps the AG2 port focused.

## How to Interact

Try asking the agent for both kinds of visuals:

**A2UI (catalog-bound):**

- "Show me a quick KPI dashboard with 3-4 metrics."
- "Show a pie chart of sales by region."
- "Render a bar chart of quarterly revenue."
- "Give me a status report on system health."

**Open Generative UI (free-form):**

- "Animate how a simple feed-forward neural network processes an input."
- "Visualize quicksort on ~10 bars of varying heights."
- "Show a 3D axis visualisation with pitch/yaw/roll labels."

The agent's system prompt (`src/agents/beautiful_chat.py`) has a
decision rule: structured / catalog-shaped requests go through
`generate_a2ui`; everything else goes through `generateSandboxedUi`.

## Technical Details

- **Frontend page:** `./page.tsx` — single combined `<CopilotKit>` with
  `a2ui={{ catalog: myCatalog }}` AND
  `openGenerativeUI={{ designSkill: ... }}`.
- **Frontend catalog:** imported directly from
  `../declarative-gen-ui/a2ui/catalog` — no duplicate copy. That same
  catalog backs the dedicated `/demos/declarative-gen-ui` cell.
- **Backend agent:** `src/agents/beautiful_chat.py` — owns
  `generate_a2ui` explicitly (mirrors `a2ui_dynamic.py`); the system
  prompt steers the LLM toward `generate_a2ui` for structured outputs
  and `generateSandboxedUi` for free-form visuals.
- **Backend mount:** `/beautiful-chat` in `src/agent_server.py`.
- **Runtime route:** `src/app/api/copilotkit-beautiful-chat/route.ts` —
  dedicated endpoint with `a2ui.injectA2UITool: false` (agent owns the
  tool) and `openGenerativeUI.agents: ["beautiful-chat"]`. Both flags
  are scoped to this cell so they don't leak into the shared
  `/api/copilotkit` endpoint.

## Reference

- Canonical (langgraph-python):
  `showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/`
- A2UI: https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
- Open Generative UI: https://docs.copilotkit.ai/generative-ui/open-generative-ui

## What's NOT Ported From the Canonical Reference

- **MCP Apps** — covered separately by `/demos/mcp-apps`.
- **App-mode toggle** (todos canvas, mode-toggle, theme provider,
  layout-level chrome) — out of scope for the simplified port; the AG2
  cell focuses on the dual-surface chat.
- **A2UI Fixed Schema** inside the same cell — covered separately by
  `/demos/a2ui-fixed-schema`.
