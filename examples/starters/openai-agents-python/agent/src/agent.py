"""The starter's agent: an OpenAI Agents SDK agent that manages a list of proverbs.

The page owns the proverbs. It sends them with every run as AG-UI state, and
the ``ag_ui_openai_agents`` adapter makes that the run's shared state: tools
read it with ``shared_state().value`` and change it with
``shared_state().update(...)``, which streams a STATE_SNAPSHOT to the page
while the run is still going.

The adapter also handles what the page registers: its frontend tools
(``setThemeColor``) and human-in-the-loop tools (``go_to_moon``) are added to
each run, and the facts it shares with ``useAgentContext`` are appended to the
instructions.
"""

from pathlib import Path
from textwrap import dedent

from ag_ui_openai_agents import OpenAIAgentsAgent, shared_state
from agents import Agent, function_tool
from dotenv import load_dotenv

from model import configure_sdk, model_settings, resolve_model

# The root .env (next to package.json) first, then one in the working directory.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv()

configure_sdk()


# =====
# Tools
# =====
def _proverbs() -> list[str]:
    return list(shared_state().value.get("proverbs") or [])


@function_tool
def get_proverbs() -> list[str]:
    """Get the current list of proverbs."""
    proverbs = _proverbs()
    print(f"📖 Getting proverbs: {proverbs}")
    return proverbs


@function_tool
def add_proverbs(proverbs: list[str]) -> str:
    """Add proverbs to the end of the list."""
    shared_state().update(proverbs=[*_proverbs(), *proverbs])
    return f"Added {len(proverbs)} proverb(s)."


@function_tool
def set_proverbs(proverbs: list[str]) -> str:
    """Replace the whole list of proverbs."""
    shared_state().update(proverbs=proverbs)
    return f"The list now has {len(proverbs)} proverb(s)."


@function_tool
def get_weather(location: str) -> str:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return f"The weather in {location} is sunny."


# =====
# Agent
# =====
# COPILOTKIT_AGENT_MODEL (e.g. "openai:gpt-6-luna") overrides this; unset, the
# agent uses gpt-6-luna.
MODEL = resolve_model("openai:gpt-6-luna")

proverbs_agent = Agent(
    name="proverbs_assistant",
    model=MODEL,
    model_settings=model_settings(MODEL),
    instructions=dedent("""
    You are a helpful assistant that helps manage and discuss proverbs.

    The user has a list of proverbs that you can help them manage.
    You have tools available to add, set, or retrieve proverbs from the list.

    When discussing proverbs, ALWAYS use the get_proverbs tool to see the current list before
    mentioning, updating, or discussing proverbs with the user.

    The app can share facts about the user and the page they are on. Use them when they
    are relevant to the question.
    """).strip(),
    tools=[get_proverbs, add_proverbs, set_proverbs, get_weather],
)

# The AG-UI wrapper `main.py` serves.
agent = OpenAIAgentsAgent(proverbs_agent)
