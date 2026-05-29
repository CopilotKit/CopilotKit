"""LangGraph agent backing the declarative-hashbrown demo.

Emits hashbrown-shaped structured output that the ported HashBrownDashboard
renderer (`src/app/demos/declarative-hashbrown/hashbrown-renderer.tsx`) progressively
parses via `@hashbrownai/react`'s `useJsonParser` + `useUiKit`.

Wire format
-----------
`@hashbrownai/react`'s `useJsonParser(content, kit.schema)` expects the agent
to stream a JSON object literal matching `kit.schema` — NOT the `<ui>...</ui>`
XML-style examples shown inside `useUiKit({ examples })`. Those XML examples
are the hashbrown prompt DSL that hashbrown compiles into a schema description
when driving the LLM directly (e.g. `useUiChat`/`useUiCompletion`). Because
this demo drives the LLM via langgraph instead, we must mirror what
hashbrown's own schema wire format looks like:

    {
      "ui": [
        { "metric":   { "props": { "label": "...", "value": "..." } } },
        { "pieChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "barChart": { "props": { "title": "...", "data": "[{...}]" } } },
        { "dealCard": { "props": { "title": "...", "stage": "prospect", "value": 100000 } } },
        { "Markdown": { "props": { "children": "## heading\\nbody" } } }
      ]
    }

Every node is a single-key object `{tagName: {props: {...}}}`. The tag names
and prop schemas match `useSalesDashboardKit()` in
`hashbrown-renderer.tsx`. `pieChart` and `barChart` receive `data` as a
JSON-encoded string (this was intentional in PR #4252 to keep the schema
stable under partial streaming).
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

from src.agents.byoc_hashbrown_prompt import BYOC_HASHBROWN_SYSTEM_PROMPT

# Force JSON-object output mode. The frontend's `useJsonParser` bails to
# `null` on any non-JSON prefix (code fences, prose preamble, etc.), so
# leaving the model free to wander out of JSON is what left the renderer
# empty in practice. `response_format={"type": "json_object"}` tells
# OpenAI to refuse to emit anything but a single JSON object, which
# aligns the wire-level contract with what the parser accepts.
graph = create_agent(
    model=ChatOpenAI(
        model="gpt-5.4",
        model_kwargs={"response_format": {"type": "json_object"}},
    ),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=BYOC_HASHBROWN_SYSTEM_PROMPT,
)
