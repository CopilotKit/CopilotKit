"""LangGraph agent backing the Agent Config Object demo.

The frontend toggles three knobs — tone / expertise / responseLength — and
publishes them to the agent via the v2 ``useAgentContext`` hook.  The
``CopilotKitMiddleware`` injects those values into the model's prompt on
every turn, so the same single static system prompt below adapts its style
based on whatever the frontend currently has selected.

``useAgentContext`` is the appropriate channel for these non-secret
user-preference values because the LLM is *meant* to read them.  All values
published via ``useAgentContext`` are serialized into the "App Context:"
system message — they are **model-visible**.

For authentication tokens and other secrets, use the ``x-*`` configurable-
header path instead (``config["configurable"]["x-copilotkit-auth"]``), which
is never serialized into state or the LLM prompt.  See the Authentication
guide for that pattern.
"""

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

# @region[agent-config-setup]
graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4", temperature=0.4),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
# @endregion[agent-config-setup]
