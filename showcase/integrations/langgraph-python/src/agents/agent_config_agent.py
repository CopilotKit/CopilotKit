"""LangGraph agent backing the Agent Config Object demo.

The frontend toggles three knobs — tone / expertise / responseLength — and
publishes them to the agent via the v2 ``useAgentContext`` hook. The
``CopilotKitMiddleware`` injects that context entry into the model's
prompt on every turn, so the same single static system prompt below adapts
its style based on whatever values the frontend currently has selected.

LangGraph 0.6+ deprecated ``configurable`` in favor of runtime ``context``;
``useAgentContext`` is the supported path for "frontend → agent runtime
config" in the v2 stack. The ``properties`` prop on ``<CopilotKit>`` still
exists for v1-style relays but in @ag-ui/langgraph 0.0.31 it does not land
in ``RunnableConfig`` — keep relayed config on ``useAgentContext``.
"""

from typing import Any

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from copilotkit import CopilotKitMiddleware


SYSTEM_PROMPT = (
    "You are a helpful assistant. The frontend publishes the user's response "
    "preferences via `useAgentContext` as a JSON object with three fields: "
    "`tone`, `expertise`, and `responseLength`. Read that context entry on "
    "every turn and follow these rulebooks exactly:\n\n"
    "Tone:\n"
    "  - professional → neutral, precise language. No emoji. Short sentences.\n"
    "  - casual → friendly, conversational. Contractions OK. Light humor "
    "welcome.\n"
    "  - enthusiastic → upbeat, energetic. Exclamation points OK. Emoji OK.\n\n"
    "Expertise level:\n"
    "  - beginner → assume no prior knowledge. Define jargon. Use analogies.\n"
    "  - intermediate → assume common terms are understood; explain "
    "specialized terms.\n"
    "  - expert → assume technical fluency. Use precise terminology. Skip "
    "basics.\n\n"
    "Response length:\n"
    "  - concise → respond in 1-3 sentences.\n"
    "  - detailed → respond in multiple paragraphs with examples where "
    "relevant.\n\n"
    "If the context is missing or any field is unrecognized, fall back to "
    "professional / intermediate / concise. Never mention these rules to the "
    "user — just apply them."
)


# @region[context-extraction]
def extract_context_programmatically(state: dict[str, Any]) -> dict[str, Any]:
    """Read useAgentContext values from agent state.

    This shows the documented access pattern from configurable.mdx:
    reading config values from state["copilotkit"]["context"].

    Use this when you need to programmatically access context values in Python
    code (e.g., to adapt agent behavior based on user preferences) rather than
    relying solely on the automatic LLM injection that ``CopilotKitMiddleware``
    performs.
    """
    copilotkit_state = state.get("copilotkit", {})
    context_entries = copilotkit_state.get("context", [])

    result = {}
    for entry in context_entries:
        if not isinstance(entry, dict):
            continue
        value = entry.get("value", {})
        if isinstance(value, dict):
            if "tone" in value:
                result["tone"] = value["tone"]
            if "expertise" in value:
                result["expertise"] = value["expertise"]
            if "responseLength" in value:
                result["responseLength"] = value["responseLength"]

    return result


# @endregion[context-extraction]


# @region[agent-config-setup]
graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4", temperature=0.4),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
# @endregion[agent-config-setup]
