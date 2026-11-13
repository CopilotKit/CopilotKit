"""agent-config: typed tone / expertise / responseLength knobs steer each reply.

The page publishes its three toggles with ``useAgentContext`` as one context
entry, which reaches the agent as ``RunAgentInput.context``. langgraph-python
lets ``CopilotKitMiddleware`` fold that entry into the prompt on every turn.
Antigravity fixes the instructions when the harness session starts, and the
adapter forwards only user messages, so the rulebook below is static and the
model reads the current values itself through the adapter's silent built-in
``get_app_context()`` tool. The user can change a toggle between any two
messages, which is why the prompt asks for a fresh read every turn.
"""

from agents._common import build

# Rulebooks as in langgraph-python's agent_config_agent.py; only the first
# sentence differs, because the model has to ask for the context.
# @region[agent-config-setup]
SYSTEM_PROMPT = (
    "You are a helpful assistant. The app publishes the user's response "
    "preferences as a JSON object with three fields: `tone`, `expertise`, "
    "and `responseLength`. Call `get_app_context` at the start of EVERY turn "
    "to read the current values (the user can change them between "
    "messages), then follow these rulebooks exactly:\n\n"
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


def agent_config_agent():
    return build(system_instructions=SYSTEM_PROMPT, experimental_app_context=True)


# @endregion[agent-config-setup]
