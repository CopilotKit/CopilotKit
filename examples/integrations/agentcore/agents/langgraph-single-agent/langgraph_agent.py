# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import base64
import json
import os
import logging

from ag_ui.core import RunAgentInput, RunErrorEvent
from bedrock_agentcore.identity.auth import requires_access_token
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from langchain.agents import create_agent
from langchain_aws import ChatBedrock
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph_checkpoint_aws import AgentCoreMemorySaver

from utils.ssm import get_ssm_parameter
from tools import query_data, AgentState, todo_tools

app = BedrockAgentCoreApp()

ACTOR_ID_KEYS = ("actor_id", "actorId", "user_id", "userId", "sub")

SYSTEM_PROMPT = """You are a helpful assistant with access to tools via the Gateway and built-in data tools.

When demonstrating charts, always call the query_data tool first to fetch data from the database before calling any chart tool.
When managing todos, use manage_todos to update the list and get_todos to read the current list.
When asked about your tools, list them and explain what they do."""


def decode_jwt_sub(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None

    parts = authorization_header.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    token_parts = parts[1].split(".")
    if len(token_parts) < 2:
        return None

    try:
        payload = token_parts[1]
        payload += "=" * ((4 - len(payload) % 4) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        sub = json.loads(decoded).get("sub")
        return sub if isinstance(sub, str) and sub else None
    except Exception:
        return None


def resolve_actor_id(
    input_data: RunAgentInput, authorization_header: str | None
) -> str | None:
    forwarded_props = (
        input_data.forwarded_props
        if isinstance(input_data.forwarded_props, dict)
        else {}
    )

    for key in ACTOR_ID_KEYS:
        value = forwarded_props.get(key)
        if isinstance(value, str) and value:
            return value

    return decode_jwt_sub(authorization_header)


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
    authorization_header = None
    if context.request_headers:
        authorization_header = context.request_headers.get("Authorization")

    actor_id = resolve_actor_id(input_data, authorization_header)
    if not actor_id:
        raise ValueError(
            "Missing actor identity. Provide forwardedProps.actor_id/user_id "
            "or include sub claim in the bearer token."
        )

    try:
        mcp_client = await create_gateway_mcp_client()
        tools = await mcp_client.get_tools()
        graph = await create_agent(
            model=_build_model(streaming=True),
            tools=[*tools, query_data, *todo_tools],  # MCP tools + data + todo tools
            checkpointer=_build_checkpointer(),
            middleware=[CopilotKitMiddleware()],
            system_prompt=SYSTEM_PROMPT,
            state_schema=AgentState,  # extends BaseAgentState with todos: list[Todo]
        )

        request_agent = LangGraphAGUIAgent(
            name="LangGraphSingleAgent",
            description="LangGraph single agent exposed via AG-UI",
            graph=graph,
            config={"configurable": {"actor_id": actor_id}},
        )
        async for event in request_agent.run(input_data):
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
