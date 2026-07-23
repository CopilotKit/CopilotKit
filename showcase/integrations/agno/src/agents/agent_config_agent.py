"""Agno agent backing the Agent Config Object demo.

Reads three forwarded properties — ``tone``, ``expertise``,
``responseLength`` — that the CopilotKit provider forwards on every run,
and composes the system prompt dynamically per turn.

Agno does not have a LangGraph-style ``configurable`` channel; instead the
custom AGUI handler in ``agent_server.py`` (mounted at
``/agent-config/agui``) reads ``RunAgentInput.forwarded_props``, builds a
fresh system prompt, and constructs a per-request Agno ``Agent`` with that
prompt before invoking it. The factory in this module produces those
per-request agents.
"""

from typing import Literal

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()


Tone = Literal["professional", "casual", "enthusiastic"]
Expertise = Literal["beginner", "intermediate", "expert"]
ResponseLength = Literal["concise", "detailed"]


DEFAULT_TONE: Tone = "professional"
DEFAULT_EXPERTISE: Expertise = "intermediate"
DEFAULT_RESPONSE_LENGTH: ResponseLength = "concise"


VALID_TONES: set[str] = {"professional", "casual", "enthusiastic"}
VALID_EXPERTISE: set[str] = {"beginner", "intermediate", "expert"}
VALID_RESPONSE_LENGTHS: set[str] = {"concise", "detailed"}


def read_properties(forwarded_props: dict | None) -> dict[str, str]:
    """Read the forwarded ``properties`` dict with defensive defaults.

    The CopilotKit provider forwards its ``properties`` prop as top-level
    keys on ``forwarded_props`` (see the runtime's run handler). This
    function never raises — every unrecognized value falls back to the
    matching ``DEFAULT_*`` constant.
    """
    props = forwarded_props or {}

    tone = props.get("tone", DEFAULT_TONE)
    expertise = props.get("expertise", DEFAULT_EXPERTISE)
    response_length = props.get("responseLength", DEFAULT_RESPONSE_LENGTH)

    if tone not in VALID_TONES:
        tone = DEFAULT_TONE
    if expertise not in VALID_EXPERTISE:
        expertise = DEFAULT_EXPERTISE
    if response_length not in VALID_RESPONSE_LENGTHS:
        response_length = DEFAULT_RESPONSE_LENGTH

    return {
        "tone": tone,
        "expertise": expertise,
        "response_length": response_length,
    }


def build_system_prompt(tone: str, expertise: str, response_length: str) -> str:
    """Compose a system prompt from the three axes."""
    tone_rules = {
        "professional": ("Use neutral, precise language. No emoji. Short sentences."),
        "casual": (
            "Use friendly, conversational language. Contractions OK. "
            "Light humor welcome."
        ),
        "enthusiastic": (
            "Use upbeat, energetic language. Exclamation points OK. Emoji OK."
        ),
    }
    expertise_rules = {
        "beginner": "Assume no prior knowledge. Define jargon. Use analogies.",
        "intermediate": (
            "Assume common terms are understood; explain specialized terms."
        ),
        "expert": ("Assume technical fluency. Use precise terminology. Skip basics."),
    }
    length_rules = {
        "concise": "Respond in 1-3 sentences.",
        "detailed": ("Respond in multiple paragraphs with examples where relevant."),
    }
    return (
        "You are a helpful assistant.\n\n"
        f"Tone: {tone_rules[tone]}\n"
        f"Expertise level: {expertise_rules[expertise]}\n"
        f"Response length: {length_rules[response_length]}"
    )


def build_agent(forwarded_props: dict | None) -> Agent:
    """Build a per-request Agno agent whose system prompt reflects the
    forwarded provider properties.

    Constructed fresh on each run so the system prompt is current; the
    Agno session DB still tracks history via ``session_id`` (the AGUI
    handler passes ``thread_id`` through).
    """
    props = read_properties(forwarded_props)
    system_prompt = build_system_prompt(
        props["tone"], props["expertise"], props["response_length"]
    )
    return Agent(
        model=OpenAIChat(id="gpt-4o-mini", temperature=0.4, timeout=120),
        tools=[],
        description=system_prompt,
    )


# A neutral default so AgentOS' agent-registry init doesn't fail before the
# first run materialises a per-request agent.
agent = build_agent(None)
