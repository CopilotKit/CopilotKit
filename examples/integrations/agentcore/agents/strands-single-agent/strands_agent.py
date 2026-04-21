# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import logging
import os

from ag_ui.core import RunAgentInput, RunErrorEvent
from ag_ui_strands import PredictStateMapping, StrandsAgent, StrandsAgentConfig, ToolBehavior
from ag_ui_strands.config import ToolCallContext
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from tools.query_data import query_data
from tools.todos import manage_todos
from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.ssm import get_ssm_parameter

app = BedrockAgentCoreApp()
logger = logging.getLogger(__name__)

ACTOR_ID_KEYS = ("actor_id", "actorId", "user_id", "userId", "sub")

SYSTEM_PROMPT = """You are a helpful assistant with access to tools via the Gateway and built-in data tools.

When demonstrating charts, always call the query_data tool first to fetch data from the database before calling any chart tool.
When managing todos, use manage_todos to update the list.
When asked about your tools, list them and explain what they do."""

BEDROCK_MODEL = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    temperature=0.1,
)


def create_gateway_mcp_client() -> MCPClient:
    """
    Create MCP client for AgentCore Gateway with OAuth2 authentication.

    Calls get_gateway_access_token() inside the lambda factory to ensure a fresh
    token is fetched on every MCP reconnection (avoids the closure trap).
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")

    return MCPClient(
        lambda: streamablehttp_client(
            url=gateway_url,
            headers={"Authorization": f"Bearer {get_gateway_access_token()}"},
        ),
        prefix="gateway",
    )


def create_strands_agent(actor_id: str, session_id: str) -> StrandsAgent:
    """
    Create a StrandsAgent wrapping a Strands SDK agent with AgentCore memory,
    Gateway MCP tools, and CopilotKit-compatible AG-UI configuration.

    Memory: AgentCoreMemorySessionManager provides cloud-persistent conversation
    history keyed by actor_id, matching the AgentCoreMemorySaver approach used
    in the LangGraph pattern.
    """
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    agentcore_memory_config = AgentCoreMemoryConfig(memory_id=memory_id, session_id=session_id, actor_id=actor_id)
    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=agentcore_memory_config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )

    gateway_client = create_gateway_mcp_client()

    # Inject current todos into the system prompt so the agent always knows
    # the latest todo state without needing a separate get_todos tool.
    def state_context_builder(state: dict) -> str:
        todos = state.get("todos", [])
        if todos:
            return f"\nCurrent todos:\n{json.dumps(todos, indent=2)}"
        return ""

    # When manage_todos is called, emit a StateSnapshotEvent with the new todos
    # so the frontend updates immediately (before the tool result arrives).
    async def todos_state_from_args(ctx: ToolCallContext) -> dict:
        todos = (ctx.tool_input or {}).get("todos", [])
        return {"todos": todos}

    # Frontend tools (generative UI / canvas controls): let the agent continue after
    # calling them so it generates a proper conclusion text. The run then finishes
    # naturally and ag_ui_strands sends a MessagesSnapshotEvent that preserves the
    # chat history. Without continue_after_frontend_call the stream halts and
    # CopilotKit v2 clears the UI because no snapshot was sent.
    frontend_tool_behavior = ToolBehavior(
        continue_after_frontend_call=False,
        skip_messages_snapshot=False,
    )

    config = StrandsAgentConfig(
        tool_behaviors={
            "manage_todos": ToolBehavior(
                state_from_args=todos_state_from_args,
                predict_state=[
                    PredictStateMapping(
                        state_key="todos",
                        tool="manage_todos",
                        tool_argument="todos",
                    )
                ],
            ),
            "pieChart": frontend_tool_behavior,
            "barChart": frontend_tool_behavior,
            "toggleTheme": frontend_tool_behavior,
            "scheduleTime": frontend_tool_behavior,
            "enableAppMode": frontend_tool_behavior,
            "enableChatMode": frontend_tool_behavior,
        },
        state_context_builder=state_context_builder,
    )

    # Build the underlying Strands agent with persistent memory and tools.
    core_agent = Agent(
        name="FASTAgent",
        system_prompt=SYSTEM_PROMPT,
        tools=[gateway_client, query_data, manage_todos],
        model=BEDROCK_MODEL,
        session_manager=session_manager,
        record_direct_tool_call=True,
        trace_attributes={
            "user.id": actor_id,
            "session.id": session_id,
        },
    )

    strands_agent = StrandsAgent(
        agent=core_agent,
        name="FASTAgent",
        description="FAST Strands agent with CopilotKit generative UI support",
        config=config,
    )

    # Pre-seed the per-thread agent cache so StrandsAgent.run() uses our
    # core_agent (which has AgentCoreMemorySessionManager) rather than creating
    # a new instance without it.
    strands_agent._agents_by_thread[session_id] = core_agent

    return strands_agent


@app.entrypoint
async def invocations(payload: dict, context: RequestContext):
    """
    Main entrypoint for the Strands agent using AG-UI protocol.

    Accepts RunAgentInput payloads from the CopilotKit Lambda Runtime,
    streams AG-UI events back, and supports generative UI, shared state
    (todos), and human-in-the-loop interactions via CopilotKit.
    """
    input_data = RunAgentInput.model_validate(payload)

    # Extract actor identity securely from the validated JWT token.
    try:
        actor_id = extract_user_id_from_context(context)
    except ValueError:
        # Fall back to forwarded props if JWT extraction fails (e.g. local dev).
        forwarded = input_data.forwarded_props if isinstance(input_data.forwarded_props, dict) else {}
        actor_id = next(
            (forwarded[k] for k in ACTOR_ID_KEYS if k in forwarded and forwarded[k]),
            None,
        )

    if not actor_id:
        raise ValueError(
            "Missing actor identity. Provide forwardedProps.actor_id/user_id or include sub claim in the bearer token."
        )

    # Use thread_id from the request (set by CopilotKit runtime) or fall back
    # to actor_id so each user gets their own persistent conversation thread.
    session_id = input_data.thread_id or actor_id

    # Ensure thread_id in the payload matches so StrandsAgent uses our pre-seeded agent.
    input_data = input_data.model_copy(update={"thread_id": session_id})

    try:
        strands_agent = create_strands_agent(actor_id, session_id)

        async for event in strands_agent.run(input_data):
            if event is not None:
                yield event.model_dump(mode="json", by_alias=True, exclude_none=True)

    except Exception as exc:
        logger.exception("Agent run failed")
        yield RunErrorEvent(
            message=str(exc) or type(exc).__name__,
            code=type(exc).__name__,
        ).model_dump(mode="json", by_alias=True, exclude_none=True)


if __name__ == "__main__":
    app.run()
