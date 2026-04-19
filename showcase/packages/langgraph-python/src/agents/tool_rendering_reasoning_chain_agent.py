"""Tool Rendering — REASONING CHAIN variant.

Combines `agentic-chat-reasoning`'s synthetic reasoning-emitter pattern
with `tool-rendering`'s multi-tool chaining. The graph loop is:

    repeat (up to MAX_STEPS):
      1) emit a reasoning chunk describing the plan for this step
      2) call gpt-4o-mini with the conversation + tool bindings
      3) if the model asked for tools, execute them, append ToolMessages,
         and loop so reasoning can explain the NEXT step.
      4) otherwise (model returned plain text), stop.

See tool_rendering_agent.py for the shared tools and prompt.
"""

from __future__ import annotations

from random import choice, randint
from typing import Any, Dict, List, Optional

from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph

MAX_STEPS = 5

SYSTEM_PROMPT = (
    "You are a helpful travel & lifestyle concierge. You have mock tools "
    "for weather, flights, stock prices, and dice rolls - they all return "
    "fake data, so call them liberally.\n\n"
    "Your habit is to CHAIN tools when one answer naturally invites another. "
    "For a single user question, call at least TWO tools in succession when "
    "the topic allows before composing your final reply."
)


@tool
def get_weather(location: str) -> dict:
    """Get the current weather for a given location."""
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


@tool
def search_flights(origin: str, destination: str) -> dict:
    """Search mock flights from an origin airport to a destination airport."""
    return {
        "origin": origin,
        "destination": destination,
        "flights": [
            {"airline": "United", "flight": "UA231", "depart": "08:15", "arrive": "16:45", "price_usd": 348},
            {"airline": "Delta", "flight": "DL412", "depart": "11:20", "arrive": "19:55", "price_usd": 312},
            {"airline": "JetBlue", "flight": "B6722", "depart": "17:05", "arrive": "01:30", "price_usd": 289},
        ],
    }


@tool
def get_stock_price(ticker: str) -> dict:
    """Get a mock current price for a stock ticker."""
    return {
        "ticker": ticker.upper(),
        "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
        "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
    }


@tool
def roll_dice(sides: int = 6) -> dict:
    """Roll a single die with the given number of sides."""
    return {"sides": sides, "result": randint(1, max(2, sides))}


TOOLS = [get_weather, search_flights, get_stock_price, roll_dice]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


class _ReasoningEmitterModel(BaseChatModel):
    """Emits exactly one reasoning chunk, then returns a plain AIMessage."""

    reasoning_text: str = ""

    @property
    def _llm_type(self) -> str:
        return "reasoning-emitter"

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        reasoning_block = {"type": "reasoning", "reasoning": self.reasoning_text, "index": 0}
        if run_manager:
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=[reasoning_block]))
            run_manager.on_llm_new_token(self.reasoning_text, chunk=chunk)
        message = AIMessage(content=[reasoning_block])
        return ChatResult(generations=[ChatGeneration(message=message)])

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[AsyncCallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        reasoning_block = {"type": "reasoning", "reasoning": self.reasoning_text, "index": 0}
        if run_manager:
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=[reasoning_block]))
            await run_manager.on_llm_new_token(self.reasoning_text, chunk=chunk)
        message = AIMessage(content=[reasoning_block])
        return ChatResult(generations=[ChatGeneration(message=message)])


def _last_user_text(messages: List[BaseMessage]) -> str:
    for msg in reversed(messages):
        if getattr(msg, "type", None) == "human":
            content = msg.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts: List[str] = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(str(block.get("text", "")))
                    elif isinstance(block, str):
                        parts.append(block)
                return "".join(parts)
    return ""


def _initial_reasoning(user_text: str) -> str:
    preview = (user_text or "").strip().replace("\n", " ")
    if len(preview) > 160:
        preview = preview[:157] + "..."
    if not preview:
        preview = "(empty prompt)"
    return (
        f'User asked: "{preview}"\n'
        "Plan: identify the best first tool to call, then consider which "
        "complementary tool would enrich the answer. Aim to chain at least "
        "two tools before responding."
    )


def _followup_reasoning(step_index: int, prior_tool_names: List[str]) -> str:
    if not prior_tool_names:
        return (
            f"Step {step_index}: no tools called yet - deciding whether the "
            "model's next message warrants another tool call or a final answer."
        )
    last = prior_tool_names[-1]
    return (
        f"Step {step_index}: already called {', '.join(prior_tool_names)}. "
        f"Evaluating whether {last}'s result invites a complementary tool "
        "call or whether I now have enough to answer directly."
    )


_answer_model = ChatOpenAI(model="gpt-4o-mini").bind_tools(TOOLS)


async def _run_step(step_messages: List[BaseMessage]) -> AIMessage:
    response = await _answer_model.ainvoke(step_messages)
    if isinstance(response, AIMessage):
        return response
    return AIMessage(
        content=response.content,
        tool_calls=getattr(response, "tool_calls", []) or [],
    )


def _execute_tool(call: Dict[str, Any]) -> ToolMessage:
    name = call.get("name", "")
    args = call.get("args", {}) or {}
    call_id = call.get("id", "")
    fn = TOOLS_BY_NAME.get(name)
    if fn is None:
        return ToolMessage(content=f"Error: unknown tool '{name}'", name=name, tool_call_id=call_id)
    try:
        result = fn.invoke(args)
    except Exception as exc:
        result = {"error": str(exc)}
    return ToolMessage(content=str(result), name=name, tool_call_id=call_id)


async def _reason_and_chain(state: MessagesState) -> dict:
    conversation = list(state["messages"])
    user_text = _last_user_text(conversation)

    await _ReasoningEmitterModel(reasoning_text=_initial_reasoning(user_text)).ainvoke(conversation)

    new_messages: List[BaseMessage] = []
    called_tool_names: List[str] = []
    prompt_prefix: List[BaseMessage] = [SystemMessage(content=SYSTEM_PROMPT)]

    for step in range(1, MAX_STEPS + 1):
        ai = await _run_step(prompt_prefix + conversation + new_messages)
        new_messages.append(ai)

        tool_calls = getattr(ai, "tool_calls", None) or []
        if not tool_calls:
            break

        for call in tool_calls:
            new_messages.append(_execute_tool(call))
            called_tool_names.append(str(call.get("name", "")))

        if step < MAX_STEPS:
            await _ReasoningEmitterModel(
                reasoning_text=_followup_reasoning(
                    step_index=step + 1,
                    prior_tool_names=called_tool_names,
                )
            ).ainvoke(conversation + new_messages)

    return {"messages": new_messages}


_builder = StateGraph(MessagesState)
_builder.add_node("reason_and_chain", _reason_and_chain)
_builder.add_edge(START, "reason_and_chain")
_builder.add_edge("reason_and_chain", END)

graph = _builder.compile()
