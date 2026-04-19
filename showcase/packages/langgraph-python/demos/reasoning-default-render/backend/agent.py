"""LangGraph agent for the Reasoning (Default Render) demo.

Identical in behavior to the `agentic-chat-reasoning` cell: forces a commodity
`gpt-4o-mini` chat model to surface a visible reasoning trace ahead of the
final answer via AG-UI `REASONING_MESSAGE_*` events.

The frontend for THIS cell does NOT register a custom `reasoningMessage` slot —
it relies on `CopilotChatReasoningMessage`, the default v2 reasoning renderer
(collapsible "Thinking…" → "Thought for Xs" card). Use this cell to verify that
reasoning tokens render out of the box without any custom component.
"""

from __future__ import annotations

from typing import Any, List, Optional

from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph

SYSTEM_PROMPT = (
    "You are a helpful assistant. Answer the user's question concisely. "
    "Do not describe your thinking — a separate reasoning trace is surfaced "
    "to the user automatically."
)


def _build_reasoning_text(user_text: str) -> str:
    preview = (user_text or "").strip().replace("\n", " ")
    if len(preview) > 160:
        preview = preview[:157] + "..."
    if not preview:
        preview = "(empty prompt)"
    return (
        "Thinking through the user's request...\n"
        f"User asked: \"{preview}\"\n"
        "Plan: identify the core question, retrieve the most direct answer, "
        "and respond in one or two short sentences."
    )


class _ReasoningEmitterModel(BaseChatModel):
    """Minimal chat model that emits a single reasoning-content chunk."""

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


_answer_model = ChatOpenAI(model="gpt-4o-mini")


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


async def _call_model(state: MessagesState) -> dict:
    messages = state["messages"]
    reasoning_text = _build_reasoning_text(_last_user_text(messages))

    emitter = _ReasoningEmitterModel(reasoning_text=reasoning_text)
    await emitter.ainvoke(messages)

    prompt_messages: List[BaseMessage] = [
        ("system", SYSTEM_PROMPT),
        *messages,
    ]
    answer = await _answer_model.ainvoke(prompt_messages)
    return {"messages": [answer]}


_builder = StateGraph(MessagesState)
_builder.add_node("call_model", _call_model)
_builder.add_edge(START, "call_model")
_builder.add_edge("call_model", END)

graph = _builder.compile()
