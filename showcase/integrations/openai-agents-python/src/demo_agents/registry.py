"""Agent name -> AG-UI agent for every demo. agent_server serves each at POST /<name>.

Names match the agent names the pages and the Next.js routes use. Demos that
need nothing beyond a neutral assistant share one agent: agents are
stateless, and every run gets its own state.
"""

from ag_ui_openai_agents import OpenAIAgentsAgent

from demo_agents.a2ui_dynamic import declarative_gen_ui_agent
from demo_agents.a2ui_fixed import a2ui_fixed_agent
from demo_agents.a2ui_recovery import a2ui_recovery_agent
from demo_agents.agent_config import agent_config_agent
from demo_agents.app_context import app_context_agent
from demo_agents.beautiful_chat import beautiful_chat_agent
from demo_agents.byoc_hashbrown import byoc_hashbrown_agent
from demo_agents.byoc_json_render import byoc_json_render_agent
from demo_agents.chat import neutral_agent
from demo_agents.gen_ui_agent import gen_ui_agent
from demo_agents.gen_ui_tool_based import gen_ui_tool_based_agent
from demo_agents.headless_complete import headless_complete_agent
from demo_agents.hitl import hitl_in_app_agent, hitl_in_chat_agent
from demo_agents.interrupt_agent import SchedulerAgent, interrupt_agent
from demo_agents.mcp_apps import mcp_apps_agent
from demo_agents.multimodal import multimodal_agent
from demo_agents.open_gen_ui import open_gen_ui_agent
from demo_agents.open_gen_ui_advanced import open_gen_ui_advanced_agent
from demo_agents.reasoning import reasoning_agent
from demo_agents.shared_state import (
    shared_state_read_agent,
    shared_state_read_write_agent,
)
from demo_agents.shared_state_streaming import (
    DocumentStreamingAgent,
    shared_state_streaming_agent,
)
from demo_agents.subagents import subagents_agent
from demo_agents.tool_rendering import tool_rendering_agent
from demo_agents.tool_rendering_reasoning_chain import (
    tool_rendering_reasoning_chain_agent,
)

neutral = OpenAIAgentsAgent(neutral_agent)
rendering = OpenAIAgentsAgent(tool_rendering_agent)
reasoning = OpenAIAgentsAgent(reasoning_agent)
scheduler = SchedulerAgent(interrupt_agent)

AGENTS: dict[str, OpenAIAgentsAgent] = {
    "agentic_chat": neutral,
    "prebuilt-sidebar": neutral,
    "prebuilt-popup": neutral,
    "chat-slots": neutral,
    "chat-customization-css": neutral,
    "headless-simple": neutral,
    "headless_complete": OpenAIAgentsAgent(headless_complete_agent),
    "beautiful_chat": OpenAIAgentsAgent(beautiful_chat_agent),
    "voice": neutral,
    "frontend_tools": neutral,
    "threadid-frontend-tool-roundtrip": neutral,
    "frontend-tools-async": neutral,
    "hitl-in-chat": OpenAIAgentsAgent(hitl_in_chat_agent),
    "hitl-in-app": OpenAIAgentsAgent(hitl_in_app_agent),
    "gen-ui-interrupt": scheduler,
    "interrupt-headless": scheduler,
    "gen-ui-tool-based": OpenAIAgentsAgent(gen_ui_tool_based_agent),
    "gen-ui-agent": OpenAIAgentsAgent(gen_ui_agent),
    "tool-rendering": rendering,
    "tool-rendering-default-catchall": rendering,
    "tool-rendering-custom-catchall": rendering,
    "auth": neutral,
    "subagents": OpenAIAgentsAgent(subagents_agent),
    "reasoning-default": reasoning,
    "reasoning-custom": reasoning,
    "tool-rendering-reasoning-chain": OpenAIAgentsAgent(
        tool_rendering_reasoning_chain_agent
    ),
    "mcp-apps": OpenAIAgentsAgent(mcp_apps_agent),
    "a2ui_fixed_schema": OpenAIAgentsAgent(a2ui_fixed_agent),
    "open_gen_ui": OpenAIAgentsAgent(open_gen_ui_agent),
    "open_gen_ui_advanced": OpenAIAgentsAgent(open_gen_ui_advanced_agent),
    "declarative_gen_ui": OpenAIAgentsAgent(declarative_gen_ui_agent),
    "a2ui_recovery": OpenAIAgentsAgent(a2ui_recovery_agent),
    "declarative_hashbrown": OpenAIAgentsAgent(byoc_hashbrown_agent),
    "declarative_json_render": OpenAIAgentsAgent(byoc_json_render_agent),
    "shared-state-read": OpenAIAgentsAgent(shared_state_read_agent),
    "shared-state-read-write": OpenAIAgentsAgent(shared_state_read_write_agent),
    "shared-state-streaming": DocumentStreamingAgent(shared_state_streaming_agent),
    "readonly-state-agent-context": OpenAIAgentsAgent(app_context_agent),
    "agent-config-demo": OpenAIAgentsAgent(agent_config_agent),
    "multimodal-demo": OpenAIAgentsAgent(multimodal_agent),
    "default": neutral,
}
