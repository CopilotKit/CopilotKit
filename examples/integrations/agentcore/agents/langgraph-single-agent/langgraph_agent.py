# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import logging
import os

from ag_ui.core import RunAgentInput, RunErrorEvent
from bedrock_agentcore.identity.auth import requires_access_token
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent, StateStreamingMiddleware, StateItem
from langchain.agents import create_agent
from langchain_aws import ChatBedrock
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph_checkpoint_aws import AgentCoreMemorySaver

from utils.auth import extract_user_id_from_context
from utils.ssm import get_ssm_parameter
from tools import query_data, AgentState, todo_tools

app = BedrockAgentCoreApp()

ACTOR_ID_KEYS = ("actor_id", "actorId", "user_id", "userId", "sub")

SYSTEM_PROMPT = """You are a helpful assistant with access to tools via the Gateway and built-in data tools.

When demonstrating charts, always call the query_data tool first to fetch data from the database before calling any chart tool.
When managing todos, use manage_todos to update the list and get_todos to read the current list.
When asked about your tools, list them and explain what they do."""


@requires_access_token(
    provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
    auth_flow="M2M",
    scopes=[],
)
async def _fetch_gateway_token(access_token: str) -> str:
    return access_token


async def create_gateway_mcp_client() -> MultiServerMCPClient:
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    fresh_token = await _fetch_gateway_token()

    return MultiServerMCPClient(
        {
            "gateway": {
                "transport": "streamable_http",
                "url": gateway_url,
                "headers": {
                    "Authorization": f"Bearer {fresh_token}",
                },
            }
        }
    )


def _build_model(streaming: bool) -> ChatBedrock:
    return ChatBedrock(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        temperature=0.1,
        max_tokens=16384,
        streaming=streaming,
        beta_use_converse_api=True,
    )


def _build_checkpointer() -> AgentCoreMemorySaver:
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    return AgentCoreMemorySaver(
        memory_id=memory_id,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


@app.entrypoint
async def invocations(payload: dict, context: RequestContext):
    input_data = RunAgentInput.model_validate(payload)

    # Extract actor identity securely from the validated JWT token.
    try:
        actor_id = extract_user_id_from_context(context)
    except ValueError:
        # Fall back to forwarded props if JWT extraction fails (e.g. local dev).
        forwarded = (
            input_data.forwarded_props
            if isinstance(input_data.forwarded_props, dict)
            else {}
        )
        actor_id = next(
            (forwarded[k] for k in ACTOR_ID_KEYS if k in forwarded and forwarded[k]),
            None,
        )

    if not actor_id:
        raise ValueError(
            "Missing actor identity. Provide forwardedProps.actor_id/user_id "
            "or include sub claim in the bearer token."
        )

    try:
        try:
            mcp_client = await create_gateway_mcp_client()
            gateway_tools = await mcp_client.get_tools()
        except Exception as gw_err:
            logging.warning("Gateway tools unavailable (running locally?): %s", gw_err)
            gateway_tools = []

        graph = create_agent(
            model=_build_model(streaming=True),
            tools=[*gateway_tools, query_data, *todo_tools],
            checkpointer=_build_checkpointer(),
            middleware=[
                CopilotKitMiddleware(),
                StateStreamingMiddleware(
                    StateItem(state_key="todos", tool="manage_todos", tool_argument="todos")
                ),
            ],
            system_prompt=SYSTEM_PROMPT,
            state_schema=AgentState,
        )

        agent = LangGraphAGUIAgent(
            name="LangGraphSingleAgent",
            description="LangGraph single agent exposed via AG-UI",
            graph=graph,
            config={"configurable": {"actor_id": actor_id}},
        )
        async for event in agent.run(input_data):
            if event is not None:
                yield event.model_dump(mode="json", by_alias=True, exclude_none=True)
    except Exception as exc:
        logging.exception("Agent run failed")
        yield RunErrorEvent(
            message=str(exc) or type(exc).__name__,
            code=type(exc).__name__,
        ).model_dump(mode="json", by_alias=True, exclude_none=True)


if __name__ == "__main__":
    app.run()