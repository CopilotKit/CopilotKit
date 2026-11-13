"""name -> AntigravityAgent for every demo. agent_server mounts each at /<name>."""

from __future__ import annotations

from agents.a2ui_dynamic import declarative_gen_ui_agent
from agents.a2ui_fixed import a2ui_fixed_agent
from agents.a2ui_recovery import a2ui_recovery_agent
from agents.agent_config import agent_config_agent
from agents.app_context import app_context_agent
from agents.beautiful_chat import beautiful_chat_agent
from agents.byoc_hashbrown import byoc_hashbrown_agent
from agents.byoc_json_render import byoc_json_render_agent
from agents.chat import neutral_agent
from agents.gen_ui_agent import gen_ui_agent
from agents.gen_ui_tool_based import gen_ui_tool_based_agent
from agents.headless_complete import headless_complete_agent
from agents.hitl import hitl_in_app_agent, hitl_in_chat_agent
from agents.mcp_apps import mcp_apps_agent
from agents.multimodal import multimodal_agent
from agents.open_gen_ui import open_gen_ui_agent
from agents.open_gen_ui_advanced import open_gen_ui_advanced_agent
from agents.reasoning import reasoning_agent
from agents.shared_state import (
    shared_state_read_agent,
    shared_state_read_write_agent,
)
from agents.subagents import subagents_agent
from agents.tool_rendering import tool_rendering_agent
from agents.tool_rendering_reasoning_chain import (
    tool_rendering_reasoning_chain_agent,
)


def build_registry() -> dict:
    neutral = neutral_agent()
    rendering = tool_rendering_agent()
    reasoning = reasoning_agent()
    return {
        "agentic_chat": neutral,
        "prebuilt-sidebar": neutral,
        "prebuilt-popup": neutral,
        "chat-slots": neutral,
        "chat-customization-css": neutral,
        "headless-simple": neutral,
        "headless_complete": headless_complete_agent(),
        "beautiful_chat": beautiful_chat_agent(),
        "voice": neutral,
        "frontend_tools": neutral,
        "threadid-frontend-tool-roundtrip": neutral,
        "frontend-tools-async": neutral,
        "hitl-in-chat": hitl_in_chat_agent(),
        "hitl-in-app": hitl_in_app_agent(),
        "gen-ui-tool-based": gen_ui_tool_based_agent(),
        "gen-ui-agent": gen_ui_agent(),
        "tool-rendering": rendering,
        "tool-rendering-default-catchall": rendering,
        "tool-rendering-custom-catchall": rendering,
        "auth": neutral,
        "subagents": subagents_agent(),
        "reasoning-default": reasoning,
        "reasoning-custom": reasoning,
        "tool-rendering-reasoning-chain": tool_rendering_reasoning_chain_agent(),
        "mcp-apps": mcp_apps_agent(),
        "a2ui_fixed_schema": a2ui_fixed_agent(),
        "open_gen_ui": open_gen_ui_agent(),
        "open_gen_ui_advanced": open_gen_ui_advanced_agent(),
        "declarative_gen_ui": declarative_gen_ui_agent(),
        "a2ui_recovery": a2ui_recovery_agent(),
        "declarative_hashbrown": byoc_hashbrown_agent(),
        "declarative_json_render": byoc_json_render_agent(),
        "shared-state-read": shared_state_read_agent(),
        "shared-state-read-write": shared_state_read_write_agent(),
        "readonly-state-agent-context": app_context_agent(),
        "agent-config-demo": agent_config_agent(),
        "multimodal-demo": multimodal_agent(),
        "default": neutral,
    }
