"""LangGraph agent backing the Agent Config Object demo.

Reads three forwarded properties — tone, expertise, responseLength — from the
LangGraph run's ``RunnableConfig["configurable"]["properties"]`` dict and
builds its system prompt dynamically per turn.

The CopilotKit provider's ``properties`` prop is wired through the runtime as
``forwardedProps`` on each AG-UI run. This graph reads those with defensive
defaults (unknown / missing values fall back to the defaults) and composes the
system prompt from three small rulebooks before invoking the model.
"""

from typing import Any, Literal

from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph


_llm: ChatOpenAI | None = None


def _get_llm() -> ChatOpenAI:
    """Lazy-instantiate the LLM so importing this module (e.g. in unit tests)
    does not require ``OPENAI_API_KEY`` to be set."""
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.4)
    return _llm

Tone = Literal["professional", "casual", "enthusiastic"]
Expertise = Literal["beginner", "intermediate", "expert"]
ResponseLength = Literal["concise", "detailed"]

DEFAULT_TONE: Tone = "professional"
DEFAULT_EXPERTISE: Expertise = "intermediate"
DEFAULT_RESPONSE_LENGTH: ResponseLength = "concise"

VALID_TONES: set[str] = {"professional", "casual", "enthusiastic"}
VALID_EXPERTISE: set[str] = {"beginner", "intermediate", "expert"}
VALID_RESPONSE_LENGTHS: set[str] = {"concise", "detailed"}


def read_properties(config: RunnableConfig | None) -> dict[str, str]:
    """Read the forwarded ``properties`` object with defensive defaults.

    Any missing or unrecognized value falls back to the corresponding
    ``DEFAULT_*`` constant. The function never raises.
    """
    configurable = (config or {}).get("configurable", {}) or {}
    properties = configurable.get("properties", {}) or {}

    tone = properties.get("tone", DEFAULT_TONE)
    expertise = properties.get("expertise", DEFAULT_EXPERTISE)
    response_length = properties.get("responseLength", DEFAULT_RESPONSE_LENGTH)

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


def call_model(
    state: MessagesState, config: RunnableConfig | None = None
) -> dict[str, Any]:
    """Single graph node — read forwarded props, build prompt, invoke LLM."""
    props = read_properties(config)
    system_prompt = build_system_prompt(
        props["tone"], props["expertise"], props["response_length"]
    )
    messages = [{"role": "system", "content": system_prompt}] + state["messages"]
    response = _get_llm().invoke(messages)
    return {"messages": [response]}


graph_builder = StateGraph(MessagesState)
graph_builder.add_node("model", call_model)
graph_builder.add_edge(START, "model")
graph_builder.add_edge("model", END)
graph = graph_builder.compile()
