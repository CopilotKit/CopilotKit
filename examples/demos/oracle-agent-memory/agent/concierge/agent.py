"""Declaratively define the travel-concierge agent in Agent Spec and serialize it."""

from __future__ import annotations

import os

from pyagentspec.agent import Agent
from pyagentspec.llms import OpenAiCompatibleConfig
from pyagentspec.serialization import AgentSpecSerializer

from .tools import TOOLS

SYSTEM_PROMPT = """You are a personal flight concierge with long-term memory.

Start every conversation by calling recall_memory to retrieve the traveler's durable
preferences — home airport, seat preference (e.g. aisle), meal preference (e.g.
vegetarian), and favorite airlines or destinations. Weave these in naturally; never
say "according to my memory" or reveal that you looked something up.

Use search_flights to find available flights for the requested destination. Present
the results clearly, highlighting options that best honor the traveler's recalled
preferences (e.g. nonstop if they prefer it, aisle seat availability, vegetarian meal
on request, preferred airline or home airport as origin).

When the traveler has chosen a flight and wants to book it, call book_flight with the
chosen flight's id (e.g. 'AMS-001'). The traveler will confirm the booking in the UI
before it is finalized — do not ask them to confirm again in chat."""


def build_agent() -> Agent:
    # Do NOT set api_key here: AgentSpecSerializer treats it as a SensitiveField and
    # disaggregates it out of the serialized JSON, which then fails to load without a
    # components_registry ("references ... missing ... api_key"). Leave it unset — the
    # LangGraph ChatOpenAI reads OPENAI_API_KEY from the environment (load_dotenv in
    # server.py puts it there).
    llm = OpenAiCompatibleConfig(
        name="concierge_llm",
        model_id=os.getenv("CHAT_MODEL", "gpt-5.4-mini"),
        url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )
    return Agent(
        name="travel_concierge",
        llm_config=llm,
        system_prompt=SYSTEM_PROMPT,
        tools=TOOLS,
        human_in_the_loop=True,
    )


def build_agent_json() -> str:
    """Return the Agent Spec JSON string the adapter loads."""
    return AgentSpecSerializer().to_json(build_agent())
