"""Native conversational variants of every CrewAI showcase Flow."""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from typing import Any, TypeVar

from crewai.experimental.conversational import (
    ConversationConfig,
    message_to_llm_dict,
)
from crewai.flow.flow import Flow, listen, start
from litellm import acompletion
from pydantic import BaseModel, ConfigDict

from ag_ui_crewai import CopilotKitState, copilotkit_stream

from agents.a2ui_fixed import A2UIFixedFlow
from agents.a2ui_recovery_flow import A2UIRecoveryFlow
from agents.beautiful_chat_flow import BeautifulChatFlow
from agents.byoc_hashbrown_agent import BYOC_HASHBROWN_SYSTEM_PROMPT
from agents.byoc_json_render_agent import BYOC_JSON_RENDER_SYSTEM_PROMPT
from agents.declarative_gen_ui import DECLARATIVE_GEN_UI_BACKSTORY
from agents.frontend_tool_flow import FrontendToolFlow
from agents.gen_ui_agent import GenUiAgentFlow
from agents.interrupt_flow import InterruptFlow
from agents.mcp_apps_agent import MCP_APPS_BACKSTORY
from agents.multimodal_flow import MultimodalFlow
from agents.reasoning_flow import ReasoningFlow
from agents.shared_state_read import SharedStateReadFlow
from agents.shared_state_read_write import SharedStateReadWriteFlow
from agents.shared_state_streaming import SharedStateStreamingFlow
from agents.subagents import SubagentsFlow
from agents.tool_rendering import ToolRenderingFlow
from agents.tool_rendering_reasoning import ToolRenderingReasoningFlow


BASE_CHAT_PROMPT = (
    "You are a concise CopilotKit showcase assistant. CRITICAL: Use any "
    "frontend tools supplied by the application whenever the user asks for "
    "their capability. "
    "Honor application context and configuration included below. After the "
    "browser returns a tool result, summarize it briefly."
)


class PromptedChatFlow(Flow[CopilotKitState]):
    """One-turn chat Flow for showcase cells that differ only by prompting."""

    system_prompt = BASE_CHAT_PROMPT

    @start()
    async def chat(self) -> None:
        state = self.state.model_dump(exclude={"messages", "copilotkit"})
        state_context = json.dumps(state, default=str, sort_keys=True)
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"{self.system_prompt}\n\n"
                            f"Application context: {state_context}"
                        ),
                    },
                    *self.state.messages,
                ],
                tools=self.state.copilotkit.actions or None,
                parallel_tool_calls=False,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


class DeclarativeGenUIFlow(PromptedChatFlow):
    system_prompt = DECLARATIVE_GEN_UI_BACKSTORY


class ByocHashbrownFlow(PromptedChatFlow):
    system_prompt = BYOC_HASHBROWN_SYSTEM_PROMPT


class ByocJsonRenderFlow(PromptedChatFlow):
    system_prompt = BYOC_JSON_RENDER_SYSTEM_PROMPT


class MCPAppsFlow(PromptedChatFlow):
    system_prompt = MCP_APPS_BACKSTORY


class _AGUIMappingState(CopilotKitState, Mapping[str, Any]):
    """Typed conversational fields plus the dict API used by untyped Flows."""

    model_config = ConfigDict(extra="allow")

    def get(self, key: str, default: Any = None) -> Any:
        value = getattr(self, key, default)
        return value.model_dump() if isinstance(value, BaseModel) else value

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def __setitem__(self, key: str, value: Any) -> None:
        setattr(self, key, value)

    def __iter__(self) -> Iterator[str]:
        return iter(self.model_dump())

    def __len__(self) -> int:
        return len(self.model_dump())


class _AGUIConversationalBehavior:
    """Route public turns through each regular Flow's existing starts."""

    def receive_user_message(self, *args: Any, **kwargs: Any) -> Any:
        result = super().receive_user_message(*args, **kwargs)
        messages = getattr(self.state, "messages", None)
        if messages and isinstance(messages[-1], BaseModel):
            messages[-1] = message_to_llm_dict(messages[-1])
        return result

    def route_turn(self, _context: Any) -> str:
        return "ag_ui_complete"

    @listen("__ag_ui_disable_builtin_end__")
    def end_conversation(self) -> None:
        return None

    @listen("ag_ui_complete")
    def finish_ag_ui_turn(self) -> None:
        return None


def _conversational_type(base: type[Any]) -> type[Any]:
    owners = [*reversed(base.mro()), _AGUIConversationalBehavior]
    flow_methods = {
        name: value
        for owner in owners
        for name, value in owner.__dict__.items()
        if not name.startswith("_") and hasattr(value, "__flow_method_definition__")
    }
    initial_state_type = getattr(base, "_initial_state_t", None)
    flow_type = type(
        f"Conversational{base.__name__}",
        (_AGUIConversationalBehavior, base),
        {
            **flow_methods,
            "__module__": __name__,
            "conversational": True,
            "conversational_config": ConversationConfig(defer_trace_finalization=False),
        },
    )
    if isinstance(initial_state_type, TypeVar):
        flow_type._initial_state_t = _AGUIMappingState
    return flow_type


CONVERSATIONAL_FLOW_TYPES = {
    "chat": _conversational_type(PromptedChatFlow),
    "declarative-gen-ui": _conversational_type(DeclarativeGenUIFlow),
    "a2ui-fixed-schema": _conversational_type(A2UIFixedFlow),
    "byoc-hashbrown": _conversational_type(ByocHashbrownFlow),
    "byoc-json-render": _conversational_type(ByocJsonRenderFlow),
    "beautiful-chat": _conversational_type(BeautifulChatFlow),
    "mcp-apps": _conversational_type(MCPAppsFlow),
    "shared-state-read-write": _conversational_type(SharedStateReadWriteFlow),
    "shared-state-read": _conversational_type(SharedStateReadFlow),
    "shared-state-streaming": _conversational_type(SharedStateStreamingFlow),
    "multimodal": _conversational_type(MultimodalFlow),
    "frontend-tools": _conversational_type(FrontendToolFlow),
    "a2ui-recovery": _conversational_type(A2UIRecoveryFlow),
    "subagents": _conversational_type(SubagentsFlow),
    "gen-ui-agent": _conversational_type(GenUiAgentFlow),
    "reasoning": _conversational_type(ReasoningFlow),
    "interrupt": _conversational_type(InterruptFlow),
    "tool-rendering": _conversational_type(ToolRenderingFlow),
    "tool-rendering-reasoning": _conversational_type(ToolRenderingReasoningFlow),
}
