"""name -> AntigravityAgent for every demo. agent_server mounts each at /<name>."""

from __future__ import annotations

from agents.beautiful_chat import beautiful_chat_agent
from agents.chat import neutral_agent
from agents.gen_ui_tool_based import gen_ui_tool_based_agent
from agents.headless_complete import headless_complete_agent
from agents.hitl import hitl_in_app_agent, hitl_in_chat_agent
from agents.mcp_apps import mcp_apps_agent
from agents.reasoning import reasoning_agent
from agents.subagents import subagents_agent
from agents.tool_rendering import tool_rendering_agent


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
        "tool-rendering": rendering,
        "tool-rendering-default-catchall": rendering,
        "tool-rendering-custom-catchall": rendering,
        "auth": neutral,
        "subagents": subagents_agent(),
        "reasoning-default": reasoning,
        "reasoning-custom": reasoning,
        "tool-rendering-reasoning-chain": rendering,
        "mcp-apps": mcp_apps_agent(),
        "default": neutral,
    }
