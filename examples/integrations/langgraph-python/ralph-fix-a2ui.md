# Ralph Loop: Fix A2UI Flight Search Rendering

## What needs to work

When a user clicks the "Flight Search (Fixed Schema A2UI)" suggestion in the chat at http://localhost:3000, the agent should call the `search_flights` tool and **A2UI flight cards must render visually in the chat**. The cards should show flight data (flight number, origin, destination, times, status) in a styled card layout — not just text.

## Current state

- The agent calls `search_flights` successfully and returns A2UI operations
- The tool returns `{"a2ui_operations": [...]}` containing `surfaceUpdate`, `dataModelUpdate`, and `beginRendering`
- But no A2UI surface renders in the chat — only the agent's text response appears

## How to validate

1. Open http://localhost:3000 in a browser
2. Click "Flight Search (Fixed Schema A2UI)" suggestion (or type the equivalent message)
3. Wait for agent response
4. Take a screenshot of the chat area
5. The screenshot MUST show rendered flight card UI components (not just text). Look for:
   - Card-like containers with flight information
   - Structured layout with flight numbers, routes (origin → destination), times
   - A2UI-rendered components (not plain text)

If no cards are visible — only text — the iteration has NOT succeeded.

## Environment

- App: http://localhost:3000 (Next.js)
- Agent: http://localhost:8123 (LangGraph Python)
- CopilotKit repo: /Users/ataibarkai/LocalGit/CopilotKit/
- AG-UI repo: /Users/ataibarkai/LocalGit/ag-ui/
- Screenshots dir: /Users/ataibarkai/LocalGit/CopilotKit/examples/integrations/langgraph-python/screenshots/

## Key files

- Agent tool: `apps/agent/src/a2ui_fixed.py` — emits A2UI operations via `copilotkit.a2ui`
- Agent tool schema: `apps/agent/src/a2ui_flight_schema.json` — component tree
- SDK helper: `/Users/ataibarkai/LocalGit/CopilotKit/sdk-python/copilotkit/a2ui.py` — `render()` wraps in `{"a2ui_operations": [...]}`
- Middleware detection: `/Users/ataibarkai/LocalGit/ag-ui/middlewares/a2ui-middleware/src/schema.ts` — `tryParseA2UIOperations()`
- Frontend renderer: `packages/v2/react/src/a2ui/A2UIMessageRenderer.tsx` — reads `content.a2ui_operations ?? content.operations`
- Frontend ignored tools: `apps/app/src/hooks/use-generative-ui-examples.tsx` — `search_flights` in ignored list

## Constraints

- Do NOT change the existing form tool (`generate_form`) or other working features
- After any TypeScript changes, rebuild: `cd /Users/ataibarkai/LocalGit/CopilotKit && npx nx run @copilotkit/react-core:build`
- After any ag-ui middleware changes, rebuild: `cd /Users/ataibarkai/LocalGit/ag-ui && npx nx run @ag-ui/a2ui-middleware:build --skip-nx-cache` then `cd /Users/ataibarkai/LocalGit/CopilotKit/examples/integrations/langgraph-python && COPILOTKIT_LOCAL=1 pnpm install --force`
- After any Python SDK changes, reinstall: `cd apps/agent && .venv/bin/pip install -e ../../../../../sdk-python`
- The agent dev server auto-reloads on Python file changes

## Completion

When flight cards render correctly in the chat, output: <promise>DONE</promise>

## Stuck handling

If after 3 attempts the cards still don't render:

1. Add console.log/print statements at each layer to trace where operations are lost
2. Check browser console for errors
3. Check agent logs for errors
4. Document what you've tried and what you've learned
