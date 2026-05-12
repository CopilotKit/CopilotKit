"""
MS Agent Framework agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Pattern (ported from the LangGraph reference
``showcase/integrations/langgraph-python/src/agents/a2ui_dynamic.py``):

- The agent binds an explicit ``generate_a2ui`` tool. When called, it invokes
  a secondary LLM with ``tool_choice`` forced to ``render_a2ui`` and returns
  the resulting ``a2ui_operations`` container.
- The runtime (see ``src/app/api/copilotkit-declarative-gen-ui/route.ts``)
  uses ``injectA2UITool: false`` because the tool binding is owned by the
  agent here (double-injection would duplicate the tool slot).

Threading the registered catalog schema into the secondary call
---------------------------------------------------------------
The CopilotKit A2UI middleware serialises the frontend-registered catalog
(component names + Zod prop schemas, brought in via
``<CopilotKit a2ui={{ catalog: myCatalog }}>``) into the AG-UI request's
``context[]`` field, with ``description`` starting with
"A2UI Component Schema" -- see
``node_modules/@ag-ui/a2ui-middleware/dist/index.mjs`` (``A2UI_SCHEMA_CONTEXT_DESCRIPTION``).

We capture that entry at request time in ``_A2UIDynamicAgent.run()`` and
stash it on a shared dict the ``generate_a2ui`` tool reads. Without it,
gpt-5.x guesses prop names (e.g. emits ``children: [...]`` on ``Card``
when the catalog defined ``child: string``, or ``status``/``delta`` on
``StatusBadge``/``Metric`` instead of ``variant``/``trend``), which the
A2UI renderer accepts as valid components but renders as blank slots —
producing the "Here's a quick KPI dashboard" + blank-canvas symptom.

Why the secondary call uses ``chat_client.client`` directly
-----------------------------------------------------------
``BaseChatClient.get_response`` runs a full function-invocation auto-loop
when tools are passed (see ``agent_framework/_tools.py:2380``). That loop
auto-EXECUTES the forced tool, feeds the result back to the model, and
iterates -- which is exactly what we don't want for a one-shot structured
output. ``response_format=PydanticModel`` is also unsuitable: A2UI
components are arbitrary dicts and OpenAI's strict JSON schema mode
rejects ``additionalProperties`` defaults.

So we drop one layer and call the underlying ``AsyncOpenAI`` client
directly -- but pull the configured model and api_key off the parent
``chat_client``, so the secondary call inherits the same model, base URL,
api_key, and any custom OpenAI configuration. This is what LangGraph
effectively does via ``model.bind_tools(...).invoke(...)``.
"""

from __future__ import annotations

import json
from textwrap import dedent
from typing import Annotated, Any

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field

from tools import build_a2ui_operations_from_tool_call

CUSTOM_CATALOG_ID = "declarative-gen-ui-catalog"


# Description prefix used by ``@ag-ui/a2ui-middleware`` when it injects the
# catalog schema context entry. Stable across catalog edits (it's the
# *description*, not the value). See the middleware bundle's
# ``A2UI_SCHEMA_CONTEXT_DESCRIPTION``.
_A2UI_SCHEMA_DESCRIPTION_PREFIX = "A2UI Component Schema"


_GENERATE_A2UI_PROMPT_HEADER = f"""\
You are designing a dynamic A2UI v0.9 surface. Call the `render_a2ui` tool
with a flat component array.

Hard requirements (failing any of these breaks the renderer -- be strict):
- `catalogId` MUST be exactly: "{CUSTOM_CATALOG_ID}"
- `surfaceId` is a short kebab-case identifier (e.g. "kpi-dashboard").
- `components` is a FLAT (non-empty) array. Every entry MUST include both an
  `id` (unique string) AND a `component` (string -- the catalog component
  name). The root entry MUST have `id: "root"` AND a valid `component`
  field -- never emit a root entry without a component type.
- Container components reference children by id via their `children` (array
  of strings) or `child` (single string) prop. Do NOT inline children
  objects. Define each child as its own entry in the flat array and
  reference its id.

CRITICAL -- all properties go at the ENTRY LEVEL
================================================
A2UI v0.9 entries are FLAT objects. EVERY property the component takes
(both basic primitives like Column/Row/Text AND custom catalog components
like Card/Metric/StatusBadge/PieChart/BarChart) goes as a SIBLING of
`id` and `component`. NEVER wrap props in a nested `"props": {{...}}`
object. The renderer reads each declared schema field directly off the
entry; a nested `props` wrapper makes them invisible to the binder.

Right:
  {{"id":"root","component":"Column","children":["a","b"],"justify":"start"}}
  {{"id":"banner","component":"Text","text":"KPI Dashboard","variant":"h2"}}
  {{"id":"m1","component":"Metric","label":"Revenue","value":"$1.2M","trend":"up"}}
  {{"id":"b1","component":"StatusBadge","text":"On track","variant":"success"}}
  {{"id":"c1","component":"Card","title":"Revenue","subtitle":"$1.2M","child":"m1"}}

Wrong (DO NOT DO THIS):
  {{"id":"m1","component":"Metric","props":{{"label":"Revenue", ...}}}}

Use ONLY the prop names declared in the catalog schema below for each
component. Do NOT invent prop names (no `status` if the schema declares
`variant`; no `delta` if it declares `trend`).
"""


_RENDER_A2UI_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "render_a2ui",
        "description": (
            "Render a dynamic A2UI v0.9 surface. The `components` array "
            "MUST be non-empty: emit at least a root component plus its "
            "children. Empty `components` is invalid and breaks the renderer."
        ),
        # ``strict: false`` because A2UI components are arbitrary dicts;
        # strict mode would require ``additionalProperties: false`` on every
        # nested object which defeats the purpose of dynamic UI. Without this
        # flag gpt-5.x defaults to strict and rejects ``items: {type: object}``
        # as under-specified, returning an empty ``components: []`` array.
        "strict": False,
        "parameters": {
            "type": "object",
            "properties": {
                "surfaceId": {
                    "type": "string",
                    "description": "Short kebab-case surface identifier.",
                },
                "catalogId": {
                    "type": "string",
                    "description": "Catalog id (use the demo's CUSTOM_CATALOG_ID).",
                },
                "components": {
                    "type": "array",
                    "minItems": 1,
                    "description": (
                        "FLAT (non-empty) array of A2UI components. Each entry "
                        "MUST have both an `id` and a `component` field. The "
                        "root entry MUST have id='root'."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "component": {"type": "string"},
                            "props": {"type": "object"},
                            "children": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "child": {"type": "string"},
                        },
                        "required": ["id", "component"],
                    },
                },
                "data": {"type": "object"},
            },
            "required": ["surfaceId", "catalogId", "components"],
        },
    },
}


SYSTEM_PROMPT = dedent(
    """
    You are a demo assistant for Declarative Generative UI (A2UI — Dynamic
    Schema). Your PRIMARY behavior is to render rich UI surfaces via the
    `generate_a2ui` tool.

    Rules (strict — do not deviate):
      1. For ANY request that mentions a dashboard, chart, KPIs, metrics,
         status report, table, card layout, sales/revenue/signups/churn/
         pie/bar/breakdown — you MUST call `generate_a2ui` before
         responding with text. Do not describe the dashboard; RENDER it.
      2. After the tool returns, send a single short sentence
         (1 sentence max) acknowledging what was rendered.
      3. Only respond with text alone when the user is asking a plain
         conversational question with no UI implication.

    `generate_a2ui` takes a `context` string summarising the user's
    request and the data they want shown; it handles the rendering
    automatically.
    """
).strip()


def _reorder_tool_messages(messages: list[Any]) -> list[Any]:
    """Move ``role=tool`` messages to immediately follow the
    ``role=assistant`` message whose ``toolCalls`` contains a matching
    ``id``. CopilotKit's frontend message store occasionally emits the
    history in the order ``[user, tool, assistant(toolCalls), assistant
    text, user]``, which violates OpenAI's "assistant with `tool_calls`
    MUST be followed by tool messages" rule and 400s on the next turn.

    Idempotent and a no-op when messages are already in the canonical
    order.
    """
    if not isinstance(messages, list) or not messages:
        return messages

    # Build a map: tool_call_id -> tool message
    tool_by_call_id: dict[str, Any] = {}
    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "tool":
            continue
        tcid = m.get("toolCallId")
        if isinstance(tcid, str):
            tool_by_call_id[tcid] = m

    if not tool_by_call_id:
        return messages

    # Walk messages, drop tool messages from their original slots, and
    # re-attach them after their matching assistant tool_calls message.
    result: list[Any] = []
    consumed_tool_ids: set[str] = set()
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            tcid = m.get("toolCallId")
            if isinstance(tcid, str) and tcid in tool_by_call_id:
                # Skip here; we'll insert it after its assistant.
                continue
        result.append(m)
        if (
            isinstance(m, dict)
            and m.get("role") == "assistant"
            and m.get("toolCalls")
        ):
            for tc in m.get("toolCalls") or []:
                tc_id = tc.get("id") if isinstance(tc, dict) else None
                if (
                    isinstance(tc_id, str)
                    and tc_id in tool_by_call_id
                    and tc_id not in consumed_tool_ids
                ):
                    result.append(tool_by_call_id[tc_id])
                    consumed_tool_ids.add(tc_id)

    # Any tool messages whose matching assistant never appeared (stale or
    # orphaned) get dropped -- they would 400 anyway, and the secondary
    # call's prompt-driven flow doesn't depend on them.
    return result


def _extract_catalog_schema(input_data: dict[str, Any]) -> str | None:
    """Pull the A2UI catalog schema JSON out of the AG-UI request context."""
    context = input_data.get("context")
    if not isinstance(context, list):
        return None
    for entry in context:
        if not isinstance(entry, dict):
            continue
        description = entry.get("description")
        if isinstance(description, str) and description.startswith(
            _A2UI_SCHEMA_DESCRIPTION_PREFIX
        ):
            value = entry.get("value")
            if isinstance(value, str) and value:
                return value
    return None


def _make_generate_a2ui_tool(
    chat_client: BaseChatClient, catalog_schema_holder: dict[str, str]
):
    """Build the ``generate_a2ui`` tool bound to ``chat_client``.

    ``catalog_schema_holder`` is a single-key dict the agent's ``run()``
    populates with the per-request A2UI catalog schema (under
    ``"current"``). The tool reads it on each invocation so the secondary
    LLM sees the exact catalog the frontend registered, not a stale or
    hardcoded list.
    """

    @tool(
        name="generate_a2ui",
        description=(
            "Generate dynamic A2UI components based on the conversation. "
            "A secondary LLM designs the UI schema and data."
        ),
    )
    async def generate_a2ui(
        context: Annotated[
            str,
            Field(description="Conversation context to generate UI from."),
        ],
    ) -> str:
        """Generate a dynamic A2UI dashboard from conversation context.

        Must ALWAYS return a string -- even on internal error -- because
        MAF's chat-completions function-invocation loop will otherwise
        send a follow-up request with an orphan ``tool_calls`` assistant
        message and OpenAI 400s with "An assistant message with
        'tool_calls' must be followed by tool messages responding to
        each 'tool_call_id'."
        """
        try:
            user_request = (
                context
                or "Generate a useful dashboard UI from the conversation context."
            )
            system_parts = [_GENERATE_A2UI_PROMPT_HEADER]
            catalog_schema = catalog_schema_holder.get("current")
            if catalog_schema:
                system_parts.append(
                    "Registered catalog schema (component names + prop types -- "
                    "use these EXACTLY):\n" + catalog_schema
                )
            response = await chat_client.client.chat.completions.create(
                model=chat_client.model,
                messages=[
                    {"role": "system", "content": "\n\n".join(system_parts)},
                    {"role": "user", "content": user_request},
                ],
                tools=[_RENDER_A2UI_TOOL_SCHEMA],
                tool_choice={
                    "type": "function",
                    "function": {"name": "render_a2ui"},
                },
            )

            tool_calls = response.choices[0].message.tool_calls or []
            if not tool_calls:
                return json.dumps({"error": "LLM did not call render_a2ui"})

            args = json.loads(tool_calls[0].function.arguments)
            # Pin the canonical catalog id -- the LLM has been observed
            # hallucinating ids from sibling demos when context is sparse.
            args["catalogId"] = CUSTOM_CATALOG_ID
            return json.dumps(build_a2ui_operations_from_tool_call(args))
        except Exception as exc:
            import traceback

            print(f"[a2ui_dynamic] generate_a2ui internal error: {exc!r}")
            traceback.print_exc()
            return json.dumps({"error": f"generate_a2ui failed: {exc!r}"})

    return generate_a2ui


def create_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed declarative-gen-ui agent."""
    catalog_schema_holder: dict[str, str] = {}

    base_agent = Agent(
        client=chat_client,
        name="declarative_gen_ui_agent",
        instructions=SYSTEM_PROMPT,
        tools=[_make_generate_a2ui_tool(chat_client, catalog_schema_holder)],
    )

    class _A2UIDynamicAgent(AgentFrameworkAgent):
        """Capture the A2UI catalog schema from the AG-UI request context."""

        async def run(self, input_data: dict[str, Any]):  # type: ignore[override]
            schema = _extract_catalog_schema(input_data)
            if schema:
                catalog_schema_holder["current"] = schema
            messages = input_data.get("messages")
            if isinstance(messages, list):
                reordered = _reorder_tool_messages(messages)
                if reordered is not messages:
                    input_data = {**input_data, "messages": reordered}
            async for event in super().run(input_data):
                yield event

    return _A2UIDynamicAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Dynamic A2UI generator that designs rich UI surfaces on demand.",
        require_confirmation=False,
    )
