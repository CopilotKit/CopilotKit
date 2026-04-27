"""Registry of all ADK agents for the showcase package.

Each demo gets its own ADK LlmAgent instance (some demos share an agent when
the only difference is frontend wiring — e.g. prebuilt-sidebar, prebuilt-popup,
chat-slots, chat-customization-css, headless-simple all share the same simple
chat agent).

`agent_server.py` iterates AGENT_REGISTRY and mounts each entry as an ADKAgent
middleware at /<agent_name>. The Next.js /api/copilotkit route then proxies
each agent name to the matching backend path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

from ag_ui_adk.config import PredictStateMapping
from google.adk.agents import LlmAgent

from agents.shared_chat import (
    build_simple_chat_agent,
    build_thinking_chat_agent,
)
from agents.gen_ui_agent import gen_ui_agent
from agents.gen_ui_tool_based_agent import gen_ui_tool_based_agent
from agents.tool_rendering_agents import (
    tool_rendering_agent,
    tool_rendering_default_catchall_agent,
    tool_rendering_custom_catchall_agent,
    tool_rendering_reasoning_chain_agent,
)
from agents.shared_state_read_write_agent import (
    shared_state_read_write_agent,
)
from agents.shared_state_streaming_agent import (
    shared_state_streaming_agent,
    SHARED_STATE_STREAMING_PREDICT_STATE,
)
from agents.subagents_agent import subagents_root_agent
from agents.hitl_in_chat_agent import hitl_in_chat_agent
from agents.hitl_in_app_agent import hitl_in_app_agent
from agents.multimodal_agent import multimodal_agent
from agents.declarative_gen_ui_agent import declarative_gen_ui_agent
from agents.a2ui_fixed_agent import a2ui_fixed_agent
from agents.byoc_agents import byoc_agent
from agents.open_gen_ui_agents import (
    open_gen_ui_agent,
    open_gen_ui_advanced_agent,
)
from agents.agent_config_agent import agent_config_agent
from agents.readonly_state_agent_context_agent import (
    readonly_state_agent_context_agent,
)
from agents.beautiful_chat_agent import beautiful_chat_agent
from agents.shared_state_read_agent import shared_state_read_agent


@dataclass
class AgentSpec:
    """Backend wiring for a single demo agent."""

    llm_agent: LlmAgent
    predict_state: Optional[Iterable[PredictStateMapping]] = field(default=None)
    emit_messages_snapshot: bool = False


# Simple conversational agents (no backend tools — frontend may inject tools).
# Used by every chat-UI demo whose only customisation is on the frontend.
_SIMPLE_CHAT_INSTRUCTION = (
    "You are a helpful, concise assistant. Keep answers short unless the user "
    "asks for detail. If a frontend tool is registered (e.g. change_background, "
    "get_weather), call it when appropriate."
)
_simple_chat = build_simple_chat_agent(
    name="SimpleChatAgent", instruction=_SIMPLE_CHAT_INSTRUCTION
)

# Reasoning-mode agent (Gemini 2.5 thinking). One shared instance for both
# reasoning demos — they differ only in frontend wiring.
_thinking_chat = build_thinking_chat_agent(
    name="ThinkingChatAgent",
    instruction=(
        "You are a thoughtful assistant. Reason step-by-step before answering. "
        "Show your reasoning chain when the request benefits from explanation, "
        "but keep the final answer concise."
    ),
)


AGENT_REGISTRY: dict[str, AgentSpec] = {
    # ----- Already-implemented demos -----
    "agentic_chat": AgentSpec(_simple_chat),
    "tool-rendering": AgentSpec(tool_rendering_agent),
    "gen-ui-tool-based": AgentSpec(gen_ui_tool_based_agent),
    "gen-ui-agent": AgentSpec(gen_ui_agent),
    "human_in_the_loop": AgentSpec(hitl_in_chat_agent),
    "shared-state-read": AgentSpec(shared_state_read_agent),
    "shared-state-write": AgentSpec(shared_state_read_write_agent),
    "shared-state-read-write": AgentSpec(shared_state_read_write_agent),
    "shared-state-streaming": AgentSpec(
        shared_state_streaming_agent,
        predict_state=SHARED_STATE_STREAMING_PREDICT_STATE,
    ),
    "subagents": AgentSpec(subagents_root_agent),
    # ----- Frontend-only demos that share the simple chat agent -----
    # (manifest declares them as separate features; agent path is shared)
    "frontend_tools": AgentSpec(_simple_chat),
    "frontend_tools_async": AgentSpec(_simple_chat),
    "prebuilt_sidebar": AgentSpec(_simple_chat),
    "prebuilt_popup": AgentSpec(_simple_chat),
    "chat_slots": AgentSpec(_simple_chat),
    "chat_customization_css": AgentSpec(_simple_chat),
    "headless_simple": AgentSpec(_simple_chat),
    "headless_complete": AgentSpec(_simple_chat),
    "voice": AgentSpec(_simple_chat),
    # ----- Reasoning demos -----
    "agentic_chat_reasoning": AgentSpec(_thinking_chat),
    "reasoning_default_render": AgentSpec(_thinking_chat),
    # ----- Tool-rendering variants -----
    "tool_rendering_default_catchall": AgentSpec(
        tool_rendering_default_catchall_agent
    ),
    "tool_rendering_custom_catchall": AgentSpec(
        tool_rendering_custom_catchall_agent
    ),
    "tool_rendering_reasoning_chain": AgentSpec(
        tool_rendering_reasoning_chain_agent
    ),
    # ----- HITL variants -----
    "hitl_in_chat": AgentSpec(hitl_in_chat_agent),
    "hitl_in_app": AgentSpec(hitl_in_app_agent),
    # ----- Multimodal & state-context -----
    "multimodal": AgentSpec(multimodal_agent),
    "readonly_state_agent_context": AgentSpec(readonly_state_agent_context_agent),
    "agent_config": AgentSpec(agent_config_agent),
    # ----- A2UI -----
    "declarative_gen_ui": AgentSpec(declarative_gen_ui_agent),
    "a2ui_fixed_schema": AgentSpec(a2ui_fixed_agent),
    # ----- BYOC -----
    "byoc_hashbrown": AgentSpec(byoc_agent),
    "byoc_json_render": AgentSpec(byoc_agent),
    # ----- Open Gen UI -----
    "open_gen_ui": AgentSpec(open_gen_ui_agent),
    "open_gen_ui_advanced": AgentSpec(open_gen_ui_advanced_agent),
    # ----- Beautiful chat -----
    "beautiful_chat": AgentSpec(beautiful_chat_agent),
    # ----- Auth (uses simple chat — auth gate is in route.ts) -----
    "auth": AgentSpec(_simple_chat),
}
