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
from typing import Optional, Sequence

from ag_ui_adk.config import PredictStateMapping
from google.adk.agents import LlmAgent

from agents.shared_chat import (
    build_simple_chat_agent,
    build_thinking_chat_agent,
)
from agents.gen_ui_agent import gen_ui_agent
from agents.gen_ui_tool_based_agent import gen_ui_tool_based_agent
from agents.tool_rendering_agent import tool_rendering_agent
from agents.tool_rendering_default_catchall_agent import (
    tool_rendering_default_catchall_agent,
)
from agents.tool_rendering_custom_catchall_agent import (
    tool_rendering_custom_catchall_agent,
)
from agents.tool_rendering_reasoning_chain_agent import (
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
from agents.hitl_in_chat_book_call_agent import hitl_in_chat_book_call_agent

# `hitl_in_chat_agent` (the langgraph-python-mirrored "task steps" flavor)
# is intentionally imported but NOT wired to the "hitl-in-chat" slot below
# — the live demo at /demos/hitl-in-chat uses the book-call flow. The
# steps-flow agent stays here so the file isn't an orphan import and so
# the eventual hitl-steps demo (planned, not yet shipped) can pick it up
# without re-implementing.
from agents.hitl_in_chat_agent import hitl_in_chat_agent  # noqa: F401
from agents.hitl_in_app_agent import hitl_in_app_agent
from agents.mcp_apps_agent import mcp_apps_agent
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
from agents.headless_complete_agent import headless_complete_agent


@dataclass
class AgentSpec:
    """Backend wiring for a single demo agent."""

    llm_agent: LlmAgent
    # Sequence (not Iterable) so a one-shot generator passed by mistake
    # doesn't silently empty after the first request consumes it. The
    # registry currently uses module-level lists, which satisfy Sequence.
    predict_state: Optional[Sequence[PredictStateMapping]] = field(default=None)
    emit_messages_snapshot: bool = False
    # `streaming_function_call_arguments=True` opts the ADKAgent middleware
    # into per-token TOOL_CALL_ARGS events (requires google-adk >= 1.24.0
    # via Vertex AI; on older / Gemini-Studio paths the middleware emits a
    # UserWarning and falls back to chunk-level emission). We pair this
    # with `PredictStateMapping(stream_tool_call=True)` for the
    # shared-state-streaming demo so the UI sees the document grow as the
    # tool arguments arrive.
    streaming_function_call_arguments: bool = False


# Simple conversational agents (no backend tools — frontend may inject tools).
# Used by every chat-UI demo whose only customisation is on the frontend.
_SIMPLE_CHAT_INSTRUCTION = (
    "You are a helpful, concise assistant. Keep answers short unless the "
    "user asks for detail. The frontend may register tools at request time "
    "(useFrontendTool / useComponent / useHumanInTheLoop) — these will "
    "appear in your tool list at the start of each turn. Call them when "
    "the user's request maps to one; fall back to plain text otherwise."
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
    # ----- Core demos with bespoke LlmAgent + tools -----
    "agentic_chat": AgentSpec(_simple_chat),
    "tool-rendering": AgentSpec(tool_rendering_agent),
    "gen-ui-tool-based": AgentSpec(gen_ui_tool_based_agent),
    "gen-ui-agent": AgentSpec(gen_ui_agent),
    "shared-state-read": AgentSpec(_simple_chat),
    "shared-state-read-write": AgentSpec(shared_state_read_write_agent),
    "shared-state-streaming": AgentSpec(
        shared_state_streaming_agent,
        predict_state=SHARED_STATE_STREAMING_PREDICT_STATE,
        streaming_function_call_arguments=True,
    ),
    "subagents": AgentSpec(subagents_root_agent),
    # ----- Frontend-only demos that share the simple chat agent -----
    # (manifest declares them as separate features; agent path is shared)
    "frontend_tools": AgentSpec(_simple_chat),
    "frontend-tools-async": AgentSpec(_simple_chat),
    "prebuilt-sidebar": AgentSpec(_simple_chat),
    "prebuilt-popup": AgentSpec(_simple_chat),
    "chat-slots": AgentSpec(_simple_chat),
    "chat-customization-css": AgentSpec(_simple_chat),
    "headless-simple": AgentSpec(_simple_chat),
    "headless_complete": AgentSpec(headless_complete_agent),
    "voice": AgentSpec(_simple_chat),
    # ----- Reasoning demos -----
    "reasoning-custom": AgentSpec(_thinking_chat),
    "reasoning-default": AgentSpec(_thinking_chat),
    # ----- Tool-rendering variants -----
    "tool-rendering-default-catchall": AgentSpec(tool_rendering_default_catchall_agent),
    "tool-rendering-custom-catchall": AgentSpec(tool_rendering_custom_catchall_agent),
    "tool-rendering-reasoning-chain": AgentSpec(tool_rendering_reasoning_chain_agent),
    # ----- HITL variants -----
    "hitl-in-chat": AgentSpec(hitl_in_chat_book_call_agent),
    "hitl-in-app": AgentSpec(hitl_in_app_agent),
    # ----- MCP Apps -----
    "mcp-apps": AgentSpec(mcp_apps_agent),
    # ----- Multimodal & state-context -----
    "multimodal": AgentSpec(multimodal_agent),
    "readonly-state-agent-context": AgentSpec(readonly_state_agent_context_agent),
    "agent_config": AgentSpec(agent_config_agent),
    # ----- A2UI -----
    "declarative_gen_ui": AgentSpec(declarative_gen_ui_agent),
    "a2ui_fixed_schema": AgentSpec(a2ui_fixed_agent),
    # ----- BYOC / Declarative -----
    "declarative-hashbrown": AgentSpec(byoc_agent),
    "byoc_json_render": AgentSpec(byoc_agent),
    # ----- Open Gen UI -----
    "open_gen_ui": AgentSpec(open_gen_ui_agent),
    "open_gen_ui_advanced": AgentSpec(open_gen_ui_advanced_agent),
    # ----- Beautiful chat -----
    "beautiful_chat": AgentSpec(beautiful_chat_agent),
    # ----- Auth (uses simple chat — auth gate is in route.ts) -----
    "auth": AgentSpec(_simple_chat),
}
