"""AG2 agent for the Declarative Generative UI (A2UI Dynamic Schema) demo.

Dynamic-schema A2UI: the LLM designs the component tree at runtime. ag2's own
A2UI stack does the work — ``A2UIServer`` injects the catalog schema and rules
into the prompt, validates the model's ``<a2ui-json>`` block against the
catalog (retrying on failure, degrading to prose if it never validates), and
``AgUiTransport`` emits the validated operations as the AG-UI ``a2ui-surface``
activity CopilotKit's renderer consumes.

The catalog is a server-side mirror of the components the page renders
(``src/app/demos/declarative-gen-ui/a2ui/definitions.ts``). Its ``$id`` MUST
stay ``declarative-gen-ui-catalog`` — the frontend registers exactly that id
(``a2ui/catalog.ts``, and ``defaultCatalogId`` in the runtime route), and a
surface bound to any other catalogId renders as "Catalog not found". The two
files are hand-synced, so a change to either must be mirrored in the other;
``tests/python/test_a2ui_dynamic_uses_ag2_stack.py`` asserts the component sets
stay equal.

The runtime route sets ``injectA2UITool: false`` — the backend owns A2UI
generation, so the JS middleware must not inject its own tool or run a
secondary render pass.
"""

from __future__ import annotations

import json
from pathlib import Path

from ag2 import Agent
from ag2.a2ui import A2UIServer, a2ui_action
from ag2.a2ui.constants import A2UI_DEFAULT_VERSION
from ag2.a2ui.transports import AgUiTransport
from ag2.config import OpenAIConfig

_CATALOG_PATH = Path(__file__).parent / "a2ui_schemas" / "declarative_gen_ui_catalog.json"

with open(_CATALOG_PATH, encoding="utf-8") as fh:
    CATALOG = json.load(fh)

SYSTEM_PROMPT = (
    "You are a demo assistant for Declarative Generative UI. Whenever a "
    "response would benefit from a rich visual — a dashboard, status report, "
    "KPI summary, card layout, or info grid — render it as A2UI instead of "
    "prose. Prefer PieChart for part-of-whole breakdowns and BarChart for "
    "comparisons across categories. Keep any chat reply to one short "
    "sentence; let the UI do the talking."
)


@a2ui_action(description="Refresh the dashboard with the latest figures")
def refresh_dashboard() -> str:
    """Server-side handler for the dashboard's refresh button.

    Runs on click WITHOUT invoking the agent — this is the ag2 A2UI action
    round-trip, not a tool call.
    """
    return "Dashboard refreshed."


agent = Agent(
    name="declarative_gen_ui_assistant",
    prompt=SYSTEM_PROMPT,
    config=OpenAIConfig(model="gpt-4o-mini", streaming=True),
)

# A2UIServer IS the ASGI app — agent_server.py mounts it directly.
a2ui_dynamic_app = A2UIServer(
    agent,
    transport=AgUiTransport(),
    actions=[refresh_dashboard],
    custom_catalog=CATALOG,
    protocol_version=A2UI_DEFAULT_VERSION,
)
