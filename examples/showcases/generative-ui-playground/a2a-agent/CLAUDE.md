# A2A Agent

Python A2A agent with A2UI (declarative generative UI) support for dynamic UI generation.

## Architecture

```
A2A Server (port 10002)
├── AgentCard: Advertises A2UI extension
├── UIGeneratorAgent: Google ADK LlmAgent
├── Tools: None (UI generated from user descriptions)
└── A2UI Output: JSON array of UI components
```

## A2UI Protocol

A2UI (Agent-to-UI) is Google's declarative generative UI protocol. The agent generates JSON describing UI components, and the frontend renders them.

### Response Format

Agent responses include text plus A2UI JSON after a delimiter:

```
Here's a contact form for you:
---a2ui_JSON---
[{"beginRendering": {...}}, {"surfaceUpdate": {...}}, {"dataModelUpdate": {...}}]
```

### A2UI Extension

The agent advertises A2UI support via:
```json
{
  "extensions": [{
    "uri": "https://a2ui.org/a2a-extension/a2ui/v0.8",
    "required": true
  }]
}
```

## Development

```bash
# Install dependencies
pip install -e .

# Run agent
python -m agent --port 10002

# Test agent card
curl http://localhost:10002/.well-known/agent.json
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-...        # Required for LiteLLM
LITELLM_MODEL=openai/gpt-5.2  # Optional, defaults to gpt-5.2
```

## UI Generation

The agent generates ANY UI type based on user requests. It uses template examples as starting points and modifies them dynamically.

### Supported UI Types

**Forms**: Contact forms, signup forms, surveys, settings panels, feedback forms
```
User: "Create a contact form with name, email, and message fields"
```

**Lists**: Todo lists, shopping lists, search results, notifications, item catalogs
```
User: "Show me a todo list with 5 items"
```

**Cards**: Profile cards, product cards, info cards, stats cards, notification cards
```
User: "Generate a profile card for John Doe, Software Engineer"
```

**Confirmations**: Success messages, error alerts, booking confirmations, status updates
```
User: "Create a success confirmation message"
```

### Adding New UI Patterns

In `prompt_builder.py`, add to `UI_EXAMPLES`:

```python
YOUR_EXAMPLE = """
---BEGIN YOUR_EXAMPLE---
[
  { "beginRendering": { "surfaceId": "...", "root": "...", "styles": {...} } },
  { "surfaceUpdate": { "surfaceId": "...", "components": [...] } },
  { "dataModelUpdate": { "surfaceId": "...", "path": "/", "contents": [...] } }
]
---END YOUR_EXAMPLE---
"""
```

Then reference it in `get_ui_prompt()`.

## Key Files

| File | Purpose |
|------|---------|
| `__main__.py` | A2A server entry, CORS, routes |
| `agent.py` | UIGeneratorAgent class, LlmAgent setup |
| `agent_executor.py` | Handles A2A protocol, parses A2UI |
| `prompt_builder.py` | A2UI schema, UI examples, system prompts |
| `tools.py` | Reserved for future tools (currently empty) |
| `a2ui_extension.py` | A2UI Part creation helpers |

## A2UI Component Types

Available components for building UIs:

| Component | Purpose |
|-----------|---------|
| `Text` | Display text with styling (h1-h5, caption, body) |
| `Icon` | Material icons (check, close, mail, phone, etc.) |
| `Row` | Horizontal layout container |
| `Column` | Vertical layout container |
| `List` | Repeating items with data binding |
| `Card` | Container with shadow/border |
| `Divider` | Visual separator |
| `Button` | Interactive button with action |
| `TextField` | Text input (shortText, longText, number, date, obscured) |
| `DateTimeInput` | Date and/or time picker |

## Styling

A2UI components are styled via the theme in `src/app/theme.ts`. The theme uses lilac/mint colors to match the mcp-apps design system.
