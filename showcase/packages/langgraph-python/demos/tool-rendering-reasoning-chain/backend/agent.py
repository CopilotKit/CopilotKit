"""Tool Rendering — REASONING CHAIN variant.

Combines two patterns the other cells keep separate:

  - `agentic-chat-reasoning` shows HOW to get `REASONING_MESSAGE_*` AG-UI
    events onto the wire when the underlying chat model (gpt-4o-mini)
    does not natively emit reasoning content chunks. It does so by
    invoking a synthetic `BaseChatModel` that streams a single
    `ChatGenerationChunk` whose message content is
    `[{type: "reasoning", reasoning: "..."}]`. `ag_ui_langgraph` turns
    that into REASONING_MESSAGE_START/CONTENT/END events which the
    frontend `reasoningMessage` slot paints as an amber block.
  - `tool-rendering` (primary) defines four mock tools (weather,
    flights, stock, dice) with a system prompt that pushes the agent
    to CHAIN at least two tool calls per user turn.

This cell runs a small multi-step reason-then-tool loop inside a single
LangGraph node:

    repeat (up to MAX_STEPS):
      1) emit a reasoning chunk describing the plan for this step
      2) call the real gpt-4o-mini with the conversation + tool bindings
      3) if the model asked for tools, execute them, append ToolMessages,
         and loop so reasoning can explain the NEXT step.
      4) otherwise (model returned plain text), stop — that's the answer.

That structure gives the frontend a visible reasoning→tool→reasoning→tool
→answer trace, which is exactly the pedagogical point: sequential tool
calls AND reasoning tokens rendered side by side.

The model kept is still `gpt-4o-mini` (cheap + same as the other cells);
if you swap in an OpenAI o1/o3 variant in the future, its native
reasoning content chunks will flow through the same
`resolve_reasoning_content` path and you can drop the synthetic emitter.
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

# Hard cap on loop iterations to keep a demo step from runaway-tool-calling.
# The shared system prompt encourages 2 tools per turn; 5 leaves headroom.
MAX_STEPS = 5

# Shared system prompt — identical to the other tool-rendering cells so the
# agent's CHAINING behaviour is consistent across the row.
SYSTEM_PROMPT = (
    "You are a helpful travel & lifestyle concierge. You have mock tools "
    "for weather, flights, stock prices, and dice rolls — they all return "
    "fake data, so call them liberally.\n\n"
    "Your habit is to CHAIN tools when one answer naturally invites another. "
    "For a single user question, call at least TWO tools in succession when "
    "the topic allows before composing your final reply. Examples of "
    "helpful chains you should default to:\n"
    "  - 'What's the weather in Tokyo?' → call get_weather('Tokyo'), then "
    "call search_flights(origin='SFO', destination='Tokyo') so the user "
    "also sees how to get there.\n"
    "  - 'How is AAPL doing?' → call get_stock_price('AAPL'), then call "
    "get_stock_price on a related ticker (e.g. 'MSFT' or 'GOOGL') for "
    "comparison.\n"
    "  - 'Roll a d20' → call roll_dice(20), then call roll_dice again with "
    "a different number of sides so the user sees a contrast.\n"
    "  - 'Find flights from SFO to JFK' → call search_flights, then call "
    "get_weather on the destination city.\n\n"
    "Only skip chaining when the user has clearly asked for a single, "
    "atomic answer and more tool calls would feel intrusive. Never "
    "fabricate data that a tool could provide."
)


# --- Tools ------------------------------------------------------------------
# Identical definitions to `tool-rendering/backend/agent.py`. Kept inline
# rather than imported so each cell is self-contained.


@tool
def get_weather(location: str) -> dict:
    """Get the current weather for a given location.

    Useful on its own for weather questions, and a great companion to
    `search_flights` — always consider checking the weather at a
    destination the user is flying to, and checking flights to any
    city whose weather the user has just asked about.
    """
    return {
        "city": location,
        "temperature": 68,
        "humidity": 55,
        "wind_speed": 10,
        "conditions": "Sunny",
    }


@tool
def search_flights(origin: str, destination: str) -> dict:
    """Search mock flights from an origin airport to a destination airport.

    Pairs naturally with `get_weather`: after searching flights, check
    the weather at the destination so the user can plan. When the user
    mentions a city without a matching origin, default the origin to
    'SFO'.
    """
    return {
        "origin": origin,
        "destination": destination,
        "flights": [
            {
                "airline": "United",
                "flight": "UA231",
                "depart": "08:15",
                "arrive": "16:45",
                "price_usd": 348,
            },
            {
                "airline": "Delta",
                "flight": "DL412",
                "depart": "11:20",
                "arrive": "19:55",
                "price_usd": 312,
            },
            {
                "airline": "JetBlue",
                "flight": "B6722",
                "depart": "17:05",
                "arrive": "01:30",
                "price_usd": 289,
            },
        ],
    }


@tool
def get_stock_price(ticker: str) -> dict:
    """Get a mock current price for a stock ticker.

    When the user asks about a single ticker, consider also pulling a
    related ticker for context (e.g. if they ask about 'AAPL', also
    fetch 'MSFT' or 'GOOGL' so the reply can compare).
    """
    return {
        "ticker": ticker.upper(),
        "price_usd": round(100 + randint(0, 400) + randint(0, 99) / 100, 2),
        "change_pct": round(choice([-1, 1]) * (randint(0, 300) / 100), 2),
    }


@tool
def roll_dice(sides: int = 6) -> dict:
    """Roll a single die with the given number of sides.

    When the user asks for a roll, consider rolling twice with different
    numbers of sides so the reply can show a contrast (e.g. a d6 AND a
    d20).
    """
    return {"sides": sides, "result": randint(1, max(2, sides))}


TOOLS = [get_weather, search_flights, get_stock_price, roll_dice]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


# --- Synthetic reasoning emitter -------------------------------------------
# Identical structural trick to `agentic-chat-reasoning/backend/agent.py`:
# a `BaseChatModel` whose `_agenerate` fires a single `on_llm_new_token`
# with a reasoning-content chunk, which ag_ui_langgraph converts into
# REASONING_MESSAGE_* AG-UI events.


class _ReasoningEmitterModel(BaseChatModel):
    """Emits exactly one reasoning chunk, then returns a plain AIMessage.

    See `agentic-chat-reasoning/backend/agent.py` for the full rationale.
    The key constraint is that the `_generate` return carries an
    `AIMessage` (not `AIMessageChunk`) so the subsequent
    `on_chat_model_end` event serializes with `type: "ai"` — which the
    ag-ui-langgraph message mapper accepts.
    """

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
        reasoning_block = {
            "type": "reasoning",
            "reasoning": self.reasoning_text,
            "index": 0,
        }
        if run_manager:
            chunk = ChatGenerationChunk(
                message=AIMessageChunk(content=[reasoning_block])
            )
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
        reasoning_block = {
            "type": "reasoning",
            "reasoning": self.reasoning_text,
            "index": 0,
        }
        if run_manager:
            chunk = ChatGenerationChunk(
                message=AIMessageChunk(content=[reasoning_block])
            )
            await run_manager.on_llm_new_token(
                self.reasoning_text, chunk=chunk
            )
        message = AIMessage(content=[reasoning_block])
        return ChatResult(generations=[ChatGeneration(message=message)])


# --- Reasoning text generation ---------------------------------------------


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
        f"User asked: \"{preview}\"\n"
        "Plan: identify the best first tool to call, then consider which "
        "complementary tool would enrich the answer. Aim to chain at least "
        "two tools before responding."
    )


def _followup_reasoning(step_index: int, prior_tool_names: List[str]) -> str:
    if not prior_tool_names:
        return (
            f"Step {step_index}: no tools called yet — deciding whether the "
            "model's next message warrants another tool call or a final answer."
        )
    last = prior_tool_names[-1]
    return (
        f"Step {step_index}: already called {', '.join(prior_tool_names)}. "
        f"Evaluating whether {last}'s result invites a complementary tool "
        "call (e.g. weather↔flights, stock↔related-ticker, dice↔second-roll) "
        "or whether I now have enough to answer directly."
    )


# --- Core graph node -------------------------------------------------------

_answer_model = ChatOpenAI(model="gpt-4o-mini").bind_tools(TOOLS)


async def _run_step(step_messages: List[BaseMessage]) -> AIMessage:
    """One chat-model call with tools bound. Returned message may have
    `tool_calls` populated (indicating more iterations are needed)."""
    response = await _answer_model.ainvoke(step_messages)
    # Normalise to AIMessage (not AIMessageChunk) so downstream consumers
    # see a fully-formed message.
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
        return ToolMessage(
            content=f"Error: unknown tool '{name}'",
            name=name,
            tool_call_id=call_id,
        )
    try:
        # `@tool` returns BaseTool; use `.invoke` so args dict is respected.
        result = fn.invoke(args)
    except Exception as exc:  # pragma: no cover — defensive for demo only
        result = {"error": str(exc)}
    return ToolMessage(content=str(result), name=name, tool_call_id=call_id)


async def _reason_and_chain(state: MessagesState) -> dict:
    """Emit reasoning then run a bounded reason→model→tools loop."""
    conversation = list(state["messages"])
    user_text = _last_user_text(conversation)

    # 1) First reasoning emit — sets up the plan before any tool runs.
    await _ReasoningEmitterModel(
        reasoning_text=_initial_reasoning(user_text)
    ).ainvoke(conversation)

    # 2) Iterative loop: call model, run any tools it requests, repeat.
    new_messages: List[BaseMessage] = []
    called_tool_names: List[str] = []
    prompt_prefix: List[BaseMessage] = [SystemMessage(content=SYSTEM_PROMPT)]

    for step in range(1, MAX_STEPS + 1):
        ai = await _run_step(prompt_prefix + conversation + new_messages)
        new_messages.append(ai)

        tool_calls = getattr(ai, "tool_calls", None) or []
        if not tool_calls:
            # Model produced a final text answer — stop.
            break

        # Run each tool call, attach results, remember what ran.
        for call in tool_calls:
            new_messages.append(_execute_tool(call))
            called_tool_names.append(str(call.get("name", "")))

        # Emit a follow-up reasoning chunk BEFORE the next model invocation,
        # so the chain has "reasoning → tool → reasoning → tool" cadence.
        if step < MAX_STEPS:
            await _ReasoningEmitterModel(
                reasoning_text=_followup_reasoning(
                    step_index=step + 1,
                    prior_tool_names=called_tool_names,
                )
            ).ainvoke(conversation + new_messages)

    return {"messages": new_messages}


# --- Graph -----------------------------------------------------------------

_builder = StateGraph(MessagesState)
_builder.add_node("reason_and_chain", _reason_and_chain)
_builder.add_edge(START, "reason_and_chain")
_builder.add_edge("reason_and_chain", END)

graph = _builder.compile()
