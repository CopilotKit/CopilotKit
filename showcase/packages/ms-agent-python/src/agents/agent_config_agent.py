"""MS Agent Framework agent backing the Agent Config Object demo.

Reads three forwarded properties -- tone, expertise, responseLength -- from the
AG-UI run input's ``forwardedProps`` and composes its system prompt dynamically
per turn.

The CopilotKit provider's ``properties`` prop is wired through the runtime as
``forwardedProps`` on each AG-UI run. Because Microsoft Agent Framework agents
are constructed with a static ``instructions`` string, we subclass
``AgentFrameworkAgent`` and intercept ``run_agent`` to prepend a freshly-built
system message derived from the forwarded props on every invocation. The
underlying base agent stays static; the per-turn customization rides in as an
extra leading message.

Invalid or missing values fall back to the corresponding ``DEFAULT_*``
constant -- this function never raises so the demo can't deadlock on a bad
payload.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from textwrap import dedent
from typing import Any, Literal

from ag_ui.core import BaseEvent
from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent

Tone = Literal["professional", "casual", "enthusiastic"]
Expertise = Literal["beginner", "intermediate", "expert"]
ResponseLength = Literal["concise", "detailed"]

DEFAULT_TONE: Tone = "professional"
DEFAULT_EXPERTISE: Expertise = "intermediate"
DEFAULT_RESPONSE_LENGTH: ResponseLength = "concise"

VALID_TONES: set[str] = {"professional", "casual", "enthusiastic"}
VALID_EXPERTISE: set[str] = {"beginner", "intermediate", "expert"}
VALID_RESPONSE_LENGTHS: set[str] = {"concise", "detailed"}


def read_properties(forwarded_props: Any) -> dict[str, str]:
    """Read forwarded props with defensive defaults.

    Any missing or unrecognized value falls back to the corresponding
    ``DEFAULT_*`` constant. Never raises.
    """
    props = forwarded_props if isinstance(forwarded_props, dict) else {}

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
    """Compose the system prompt from the three axes."""
    tone_rules = {
        "professional": (
            "Use neutral, precise language. No emoji. Short sentences."
        ),
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
        "expert": (
            "Assume technical fluency. Use precise terminology. Skip basics."
        ),
    }
    length_rules = {
        "concise": "Respond in 1-3 sentences.",
        "detailed": (
            "Respond in multiple paragraphs with examples where relevant."
        ),
    }
    return (
        "You are a helpful assistant.\n\n"
        f"Tone: {tone_rules[tone]}\n"
        f"Expertise level: {expertise_rules[expertise]}\n"
        f"Response length: {length_rules[response_length]}"
    )


class AgentConfigFrameworkAgent(AgentFrameworkAgent):
    """AgentFrameworkAgent that rebuilds its system prompt per request.

    Overrides ``run_agent`` to read ``forwardedProps`` from the AG-UI input
    and prepend a system message carrying the tone / expertise / responseLength
    directives before delegating to the standard orchestrator chain. Mutating
    the ``messages`` list in ``input_data`` is the least invasive hook: the
    downstream orchestrator treats the prepended message like any other
    system entry and flows it into the model alongside user turns.
    """

    async def run_agent(  # type: ignore[override]
        self,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[BaseEvent, None]:
        props = read_properties(input_data.get("forwardedProps"))
        system_prompt = build_system_prompt(
            props["tone"], props["expertise"], props["response_length"]
        )

        messages = list(input_data.get("messages") or [])
        # Prepend the dynamic system message. Using AG-UI's on-the-wire
        # dict shape (role/content) keeps us compatible with the message
        # adapter without needing to import its internals.
        messages.insert(
            0,
            {
                "id": "agent-config-system",
                "role": "system",
                "content": system_prompt,
            },
        )

        patched_input = dict(input_data)
        patched_input["messages"] = messages

        async for event in super().run_agent(patched_input):
            yield event


def create_agent_config_agent(chat_client: BaseChatClient) -> AgentConfigFrameworkAgent:
    """Instantiate the Agent Config demo agent.

    The base MS Agent Framework ``Agent`` carries only a neutral fallback
    instruction. The real behavioural steering happens in the per-request
    system message injected by ``AgentConfigFrameworkAgent.run_agent``.
    """
    base_agent = Agent(
        client=chat_client,
        name="agent_config",
        instructions=dedent(
            """
            You are a helpful assistant. Follow the tone, expertise level, and
            response-length directives provided in the system message for each
            turn. If no directive is provided, use professional / intermediate
            / concise defaults.
            """.strip()
        ),
        tools=[],
    )

    return AgentConfigFrameworkAgent(
        agent=base_agent,
        name="AgentConfigObjectDemo",
        description=(
            "Reads tone / expertise / responseLength from forwardedProps "
            "and builds its system prompt per turn."
        ),
        require_confirmation=False,
    )
