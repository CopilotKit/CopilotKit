"""AG2 agent backing the Agent Config Object demo.

Reads three forwarded properties — tone, expertise, responseLength — from
shared state (ContextVariables on each run) and adapts its responses
accordingly.

Wire format
-----------
The frontend uses `agent.setState({ tone, expertise, responseLength })` from
the demo page. AG2's AGUIStream maps that initial state into ContextVariables
on every run. The agent has a `get_current_config` tool that returns the
current rulebook for the assistant to consult before answering.

The system prompt instructs the agent to call `get_current_config` once at
the start of every conversation turn so the response style adapts to the
latest UI selection.

References:
- src/agents/shared_state_read_write.py — same ContextVariables pattern.
"""

import logging

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from autogen.agentchat import ContextVariables
from autogen.tools import tool
from fastapi import FastAPI

logger = logging.getLogger(__name__)

VALID_TONES = {"professional", "casual", "enthusiastic"}
VALID_EXPERTISE = {"beginner", "intermediate", "expert"}
VALID_RESPONSE_LENGTHS = {"concise", "detailed"}

DEFAULT_TONE = "professional"
DEFAULT_EXPERTISE = "intermediate"
DEFAULT_RESPONSE_LENGTH = "concise"

TONE_RULES = {
    "professional": "Use neutral, precise language. No emoji. Short sentences.",
    "casual": (
        "Use friendly, conversational language. Contractions OK. "
        "Light humor welcome."
    ),
    "enthusiastic": (
        "Use upbeat, energetic language. Exclamation points OK. Emoji OK."
    ),
}

EXPERTISE_RULES = {
    "beginner": "Assume no prior knowledge. Define jargon. Use analogies.",
    "intermediate": (
        "Assume common terms are understood; explain specialized terms."
    ),
    "expert": (
        "Assume technical fluency. Use precise terminology. Skip basics."
    ),
}

LENGTH_RULES = {
    "concise": "Respond in 1-3 sentences.",
    "detailed": (
        "Respond in multiple paragraphs with examples where relevant."
    ),
}


SYSTEM_PROMPT = (
    "You are a helpful assistant whose response style is governed by a UI-"
    "supplied configuration object. Before answering ANY user question, "
    "call the `get_current_config` tool exactly once to read the latest "
    "tone / expertise / response-length rulebook. Then answer the user's "
    "question, strictly following those rules. Never mention the tool call "
    "or the configuration in your reply — just adapt your style."
)


@tool()
def get_current_config(context_variables: ContextVariables) -> str:
    """Return the current rulebook (tone / expertise / length) for the assistant.

    Reads the forwarded ``tone``, ``expertise``, and ``responseLength``
    properties from shared state, falling back to defaults for any missing
    or unrecognized value.
    """
    data = context_variables.data or {}
    tone = data.get("tone", DEFAULT_TONE)
    expertise = data.get("expertise", DEFAULT_EXPERTISE)
    response_length = data.get("responseLength", DEFAULT_RESPONSE_LENGTH)

    if tone not in VALID_TONES:
        tone = DEFAULT_TONE
    if expertise not in VALID_EXPERTISE:
        expertise = DEFAULT_EXPERTISE
    if response_length not in VALID_RESPONSE_LENGTHS:
        response_length = DEFAULT_RESPONSE_LENGTH

    return (
        f"Tone ({tone}): {TONE_RULES[tone]}\n"
        f"Expertise ({expertise}): {EXPERTISE_RULES[expertise]}\n"
        f"Response length ({response_length}): {LENGTH_RULES[response_length]}"
    )


agent_config_agent = ConversableAgent(
    name="agent_config_assistant",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=5,
    functions=[get_current_config],
)

agent_config_stream = AGUIStream(agent_config_agent)

agent_config_app = FastAPI()
agent_config_app.mount("/", agent_config_stream.build_asgi())
