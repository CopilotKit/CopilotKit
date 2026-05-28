"""Dynamic-schema Q&A agent.

The agent answers any question about the most-recently-uploaded PDF by
inventing the UI for the answer using our custom catalog.

## Why this looks the way it does

The first cut wired things up to use the JS-runtime-injected `render_a2ui`
frontend tool. That works on turn 1 but leaves an orphan
`function_call` in agent state (CopilotKitMiddleware strips frontend
tool calls in `after_model` and restores them in `after_agent`. between
those two phases ToolNode never sees the call, so no `ToolMessage` is
ever produced). The result is turn 2 hitting OpenAI's Responses API
with an unanswered function_call → INCOMPLETE_STREAM / "terminated".

The CopilotKit reference example in
`CopilotKit/examples/integrations/langgraph-python` solves this by
NOT injecting `render_a2ui` as a frontend tool at all. Instead, the
agent has a real Python tool (`generate_a2ui` here) that:

  1. Runs server-side as a normal LangChain tool.
  2. Spawns a secondary LLM bound to a no-op `render_a2ui` tool to
     force structured output.
  3. Wraps the LLM's tool_call args into A2UI `create_surface` +
     `update_components` + `update_data_model` operations.
  4. Returns the rendered ops as a JSON string. a normal tool result.

The JS-side a2ui middleware detects `a2ui_operations` in the
TOOL_CALL_RESULT and emits the ACTIVITY_SNAPSHOT events the canvas
listens for. No frontend tool stripping. No orphan. No turn-2 crash.

`web/src/app/api/copilotkit/route.ts` sets `injectA2UITool: false` to
match.
"""
from __future__ import annotations

import json
from typing import Any

from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import SystemMessage
from langchain_core.tools import tool as lc_tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver

from src.catalog import CATALOG_ID, CATALOG_PROMPT
from src.pdf_tools import query_pdf


# No-op shim. The secondary LLM is forced to call this tool so its output
# is a structured tool_call (surfaceId / catalogId / components / data)
# instead of free-form prose we'd have to JSON-parse and validate.
@lc_tool
def render_a2ui(
    surfaceId: str,
    catalogId: str,
    components: list[dict],
    data: dict | None = None,
) -> str:
    """Render a dynamic A2UI v0.9 surface.

    Args:
        surfaceId: Unique surface identifier (kebab-case).
        catalogId: The catalog ID. Use the one provided in context.
        components: A2UI v0.9 flat component array; root component MUST
            have id="root".
        data: Optional initial data model for the surface.
    """
    return "rendered"


_RENDER_MODEL = ChatOpenAI(model="gpt-5.5", temperature=0)


@tool()
def generate_a2ui(runtime: ToolRuntime[Any]) -> str:
    """Render the answer to the user's question as an A2UI surface.

    Call this AFTER `query_pdf`. It reads the conversation (including the
    query_pdf result) and the available A2UI catalog from context, then
    designs the surface and returns the operations for the client to
    render. You do NOT pass any arguments. It picks up everything from
    state.
    """
    messages = runtime.state["messages"][:-1]
    context_entries = runtime.state.get("copilotkit", {}).get("context", [])
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    # The runtime context only carries the basic catalog. Append our
    # custom catalog spec so the secondary LLM picks our components, not
    # the generic A2UI primitives.
    custom_catalog_note = (
        f"\n\n## Use THIS catalog (NOT the basic one above):\n"
        f"catalogId: {CATALOG_ID}\n\n"
        f"{CATALOG_PROMPT}\n"
    )

    prompt = (
        f"{context_text}\n{custom_catalog_note}\n"
        "Design the surface using ONLY components from the catalog above. "
        "Inline all data (use plain values, not {{path}} bindings, unless a "
        "property explicitly accepts a path). The user's request is in the "
        "most recent messages. Honor the words they used (chart type, "
        "comparison, etc.)."
    )

    model_with_tool = _RENDER_MODEL.bind_tools(
        [render_a2ui], tool_choice="render_a2ui"
    )
    response = model_with_tool.invoke(
        [SystemMessage(content=prompt), *messages]
    )

    if not response.tool_calls:
        return json.dumps({"error": "secondary LLM did not call render_a2ui"})

    args = response.tool_calls[0]["args"]
    surface_id = args.get("surfaceId", "dynamic-surface")
    catalog_id = args.get("catalogId", CATALOG_ID)
    components = args.get("components", [])
    data = args.get("data", {})

    ops = [
        a2ui.create_surface(surface_id, catalog_id=catalog_id),
        a2ui.update_components(surface_id, components),
    ]
    if data:
        ops.append(a2ui.update_data_model(surface_id, data))

    return a2ui.render(operations=ops)


SYSTEM_PROMPT = f"""\
You answer questions about a user's attached PDF and render the answer
as an A2UI surface using our custom catalog.

## Where the PDF lives

The frontend extracts the PDF text and inlines it into the user's
message under a `[Document: <filename>]` header. The PDF may have been
attached on the CURRENT turn or on ANY EARLIER turn in this conversation.
A user typically attaches a PDF once and then asks several follow-up
questions about it without re-attaching.

## How to find the PDF text

Scan the entire conversation history (every user message, oldest to
newest). Find the MOST RECENT user message that contains a
`[Document: <filename>]` header. That message's body is the active PDF
text and applies to every subsequent follow-up question UNTIL the user
attaches a different PDF.

Only if NO message in the history has ever contained a
`[Document: ...]` header should you ask the user to attach a PDF.

## How a turn MUST go (do not deviate)

1. If NO message in the conversation history has a `[Document: ...]`
   header, reply with a single sentence: "Attach a PDF and I'll render
   the answer." STOP. Do not call any tool.
2. Otherwise (a PDF is available from this turn or a previous one):
   a. ONE call to `query_pdf(pdf_text=<the document text from the most
      recent [Document: ...] message>, question=<the user's question on
      THIS turn>)`. The tool returns JSON with shape_hint, title,
      summary, data. Read it silently. DO NOT type the JSON anywhere.
   b. ONE call to `generate_a2ui()`. No arguments.
   c. STOP. Do not call any more tools. Do not write any chat content.
      Your final assistant message MUST be an empty string. The rendered
      surface IS the user-visible answer.

## Absolute hard rules. Breaking ANY of these causes a crash.

- After `generate_a2ui` returns, you are DONE for this turn. Do not call
  `query_pdf` again. Do not call `generate_a2ui` again. Do not write
  anything except an empty string.
- NEVER include the query_pdf JSON in your reply.
- NEVER include any tool's return value in your reply.
- NEVER quote the PDF text, summarize the document, or echo any part of
  `pdf_text` back into the chat.
- The chat reply MUST be either empty ("") or a single very short
  sentence (under 10 words). Empty is preferred.

## Layout guidance for generate_a2ui

The secondary LLM sees the same conversation you do. When the user is
specific ("three line charts stacked", "side-by-side cards"), the
secondary LLM will honor it. Defaults per shape_hint:

- `stat`  -> Stack(Overline, StatCard)
- `trend` -> Stack(Section -> Card -> LineChart)
- `share` -> Stack(Section -> Card -> DonutChart)
- `table` -> Stack(Section -> Card -> DataTable)
- `text`  -> Rich explainer. Compose multiple components, not just one Card:
              Stack(
                Overline(topic),
                Heading(title),
                Text(intro paragraph, 2-4 sentences),
                Callout(tone=info, title="Key idea", body=core insight),
                Section(title="Why it matters", child=Card(Text(...))),
                BulletList(items=[3 key points]),
              )
              Use Callout for the "headline takeaway", BulletList for
              enumerations, and Text for paragraphs. Mix with one chart
              ONLY if the question genuinely benefits from data viz.

Heuristic for research-paper questions: prefer the rich `text` layout
above. Skip charts unless the user explicitly asked for data viz.

## Restating the loop guard

- Max two tool calls per turn. query_pdf (once) + generate_a2ui (once).
- After generate_a2ui returns, STOP IMMEDIATELY.
- Never describe the surface in prose. The surface IS the answer.

{CATALOG_PROMPT}
"""


def build_dynamic_agent():
    return create_agent(
        model="openai:gpt-5.5",
        tools=[query_pdf, generate_a2ui],
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=MemorySaver(),
    )


graph = build_dynamic_agent()
