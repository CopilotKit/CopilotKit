"""LangGraph agent for the Agentic Chat (Reasoning) demo.

The CopilotKit React v2 chat UI renders a `role="reasoning"` message via the
`reasoningMessage` slot. Those messages arise from AG-UI `REASONING_MESSAGE_*`
events which `ag_ui_langgraph` derives from chat-model stream chunks whose
`content` is `[{"type": "reasoning", "reasoning": "..."}]` (see
`ag_ui_langgraph.utils.resolve_reasoning_content`).

Commodity chat models like `gpt-4o-mini` do not emit reasoning content chunks,
so this demo cannot rely on the underlying model to surface reasoning. Instead,
this agent runs two chat-model calls in sequence inside a single node:

  1. A synthetic `_ReasoningEmitterModel` (a minimal `BaseChatModel` subclass)
     streams one `ChatGenerationChunk` whose message carries reasoning content
     (`{type: "reasoning", reasoning: "..."}`). `ag_ui_langgraph` converts that
     into `REASONING_MESSAGE_START / CONTENT / END` AG-UI events — exactly
     what the frontend's reasoning slot renders.
  2. The real `ChatOpenAI(model="gpt-4o-mini")` generates the user-facing
     answer, which flows through as `TEXT_MESSAGE_*` events.

Both invocations produce their own `on_chat_model_stream` event sequences, so
the reasoning events arrive before the assistant answer and render as the
amber "Reasoning" block defined in the demo page.
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
    """Construct a short, visible reasoning trace for the demo.

    Kept deterministic so the frontend banner is reliably populated regardless
    of the user's prompt. The real value of this demo is showing *where* the
    reasoning block renders; the text is illustrative.
    """
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
    """Minimal chat model that emits a single reasoning-content chunk.

    Used only to trigger the `on_chat_model_stream` -> `REASONING_MESSAGE_*`
    event path in `ag_ui_langgraph`. The node below invokes this via
    `.ainvoke()`; `_agenerate` manually fires `on_llm_new_token` (which
    becomes an `on_chat_model_stream` event carrying the reasoning chunk)
    and then returns a regular `AIMessage` as the model output so the
    subsequent `on_chat_model_end` event is well-formed (`type="ai"` — the
    ag-ui-langgraph client rejects `AIMessageChunk` outputs at snapshot time).
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
            # Fires `on_chat_model_stream` with our reasoning content. The
            # ag_ui_langgraph layer calls `resolve_reasoning_content` on this
            # chunk and emits REASONING_MESSAGE_START/CONTENT/END events.
            run_manager.on_llm_new_token(self.reasoning_text, chunk=chunk)
        # Return a plain AIMessage (not AIMessageChunk). on_chat_model_end's
        # `output` will carry this message, which serializes with `type: "ai"`
        # — the supported case in the ag-ui-langgraph message mapper.
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
    """Emit a reasoning trace, then produce the user-facing answer."""
    messages = state["messages"]
    reasoning_text = _build_reasoning_text(_last_user_text(messages))

    # 1) Emit reasoning via a synthetic chat-model invocation. The returned
    #    AIMessage is discarded — it only exists so AG-UI can emit
    #    REASONING_MESSAGE_* events from the model's stream chunk.
    emitter = _ReasoningEmitterModel(reasoning_text=reasoning_text)
    await emitter.ainvoke(messages)

    # 2) Produce the real answer with the real model.
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
