# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

print("[MODULE] Starting module import...")

try:
    from langchain.agents import create_agent
    print("[MODULE] create_agent imported successfully")
except ImportError as e:
    print(f"[MODULE ERROR] Failed to import create_agent: {e}")
    create_agent = None
from langchain_aws import ChatBedrock
from langchain_mcp_adapters.client import MultiServerMCPClient
import os
import boto3
from bedrock_agentcore.identity.auth import requires_access_token
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
import traceback

# Use official LangGraph AWS integration for memory
from langgraph_checkpoint_aws import AgentCoreMemorySaver

from utils.auth import extract_user_id_from_context
from utils.ssm import get_ssm_parameter

print("[MODULE] All imports done, creating app...")
app = BedrockAgentCoreApp()
print("[MODULE] App created successfully")

# OAuth2 Credential Provider decorator from AgentCore Identity SDK.
# Automatically retrieves OAuth2 access tokens from the Token Vault (with caching)
# or fetches fresh tokens from the configured OAuth2 provider when expired.
# The provider_name references an OAuth2 Credential Provider registered in AgentCore Identity.
@requires_access_token(
    provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
    auth_flow="M2M",
    scopes=[]
)
async def _fetch_gateway_token(access_token: str) -> str:
    """
    Fetch fresh OAuth2 token for AgentCore Gateway authentication.
    
    This is async because it's called with 'await' in create_gateway_mcp_client().
    The @requires_access_token decorator handles token retrieval and refresh:
    1. Token Retrieval: Calls GetResourceOauth2Token API to fetch token from Token Vault
    2. Automatic Refresh: Uses refresh tokens to renew expired access tokens
    3. Error Orchestration: Handles missing tokens and OAuth flow management
    
    For M2M (Machine-to-Machine) flows, the decorator uses Client Credentials grant type.
    The provider_name must match the Name field in the CDK OAuth2CredentialProvider resource.
    """
    return access_token


async def create_gateway_mcp_client() -> MultiServerMCPClient:
    """
    Create an MCP client connected to the AgentCore Gateway with OAuth2 authentication.

    MCP (Model Context Protocol) is how agents communicate with tool providers.
    This creates a client that can talk to the AgentCore Gateway using OAuth2
    authentication. The Gateway then provides access to Lambda-based tools.
    
    This implementation avoids the "closure trap" by calling _fetch_gateway_token()
    on every invocation of create_gateway_mcp_client(). Since this function is called
    per-request in agent_stream(), it ensures fresh tokens for each request.
    """
    stack_name = os.environ.get('STACK_NAME')
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")
    
    # Validate stack name format to prevent injection
    if not stack_name.replace('-', '').replace('_', '').isalnum():
        raise ValueError("Invalid STACK_NAME format")
    
    print(f"[AGENT] Creating Gateway MCP client for stack: {stack_name}")
    
    # Fetch Gateway URL from SSM
    gateway_url = get_ssm_parameter(f'/{stack_name}/gateway_url')
    print(f"[AGENT] Gateway URL from SSM: {gateway_url}")
    
    # Fetch fresh token on every call to avoid closure trap
    fresh_token = await _fetch_gateway_token()
    
    # Create MCP client with Bearer token authentication
    gateway_client = MultiServerMCPClient({
        "gateway": {
            "transport": "streamable_http",
            "url": gateway_url,
            "headers": {
                "Authorization": f"Bearer {fresh_token}"
            }
        }
    })
    
    print("[AGENT] Gateway MCP client created successfully")
    return gateway_client


async def create_langgraph_agent(user_id: str, session_id: str, tools: list):
    """
    Create a LangGraph agent with AgentCore Gateway MCP tools and memory integration.
    
    This function sets up a LangGraph StateGraph that can access tools through
    the AgentCore Gateway and maintains conversation memory.
    """
    system_prompt = """You are a helpful assistant with access to tools via the Gateway.
    When asked about your tools, list them and explain what they do."""

    # Create Bedrock model
    bedrock_model = ChatBedrock(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        temperature=0.1,
        streaming=True
    )

    # Get and validate Memory ID
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")
    
    # Configure AgentCore Memory using official LangGraph AWS integration
    checkpointer = AgentCoreMemorySaver(
        memory_id=memory_id,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )

    try:
        print("[AGENT] Creating LangGraph agent with Gateway tools...")
        
        graph = create_agent(
            model=bedrock_model,
            tools=tools,
            checkpointer=checkpointer,
            prompt=system_prompt,
            middleware=[CopilotKitMiddleware()],
        )
        
        print("[AGENT] Agent created successfully with Gateway tools")
        return graph
        
    except Exception as e:
        print(f"[AGENT ERROR] Error creating LangGraph agent: {e}")
        print(f"[AGENT ERROR] Exception type: {type(e).__name__}")
        print(f"[AGENT ERROR] Traceback:")
        traceback.print_exc()
        raise


# ---------------------------------------------------------------------------
# CopilotKit / AG-UI integration (opt-in via AGUI_ENABLED env var)
# ---------------------------------------------------------------------------
# When enabled, the agent additionally handles AG-UI protocol requests sent by
# the CopilotKit runtime Lambda.  The original streaming path above is kept
# unchanged for the default frontend.
# ---------------------------------------------------------------------------
AGUI_ENABLED = os.environ.get("AGUI_ENABLED", "").lower() == "true"
print(f"[MODULE] AGUI_ENABLED={AGUI_ENABLED}, raw env={os.environ.get('AGUI_ENABLED', 'NOT SET')}")

if AGUI_ENABLED:
    print("[MODULE] Importing AGUI dependencies...")
    import logging
    try:
        from ag_ui.core import RunAgentInput, RunErrorEvent
        print("[MODULE] ag_ui.core imported OK")
    except ImportError as e:
        print(f"[MODULE ERROR] ag_ui.core import failed: {e}")
    try:
        from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
        print("[MODULE] copilotkit imported OK")
    except ImportError as e:
        print(f"[MODULE ERROR] copilotkit import failed: {e}")



def _is_agui_request(payload: dict) -> bool:
    """Detect whether the incoming payload is an AG-UI RunAgentInput.

    The AG-UI protocol serializes keys as camelCase (threadId, runId) in JSON.
    """
    return ("threadId" in payload or "thread_id" in payload) and \
           ("runId" in payload or "run_id" in payload)


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the LangGraph agent using streaming with Gateway integration.
    
    This is the function that AgentCore Runtime calls when the agent receives a request.
    It extracts the user's query from the payload, securely obtains the user ID from
    the validated JWT token in the request context, creates a LangGraph agent with Gateway
    tools and memory, and streams the response back. This function handles the complete
    request lifecycle with token-level streaming. The user ID is extracted from the 
    JWT token (via RequestContext).

    When AGUI_ENABLED is set, AG-UI protocol requests (from the CopilotKit
    runtime Lambda) are detected and handled via LangGraphAGUIAgent instead.
    """
    print(f"[STREAM] agent_stream called, payload keys: {list(payload.keys())}")
    print(f"[STREAM] AGUI_ENABLED={AGUI_ENABLED}, is_agui={_is_agui_request(payload)}")

    # --- CopilotKit / AG-UI path (must check BEFORE prompt/sessionId check) ---
    if AGUI_ENABLED and _is_agui_request(payload):
        print("[STREAM] Taking AGUI path")
        input_data = RunAgentInput.model_validate(payload)
        user_id = extract_user_id_from_context(context)
        if not user_id:
            raise ValueError("Missing actor identity.")

        mcp_client = await create_gateway_mcp_client()
        tools = await mcp_client.get_tools()
        graph = await create_langgraph_agent(user_id, input_data.thread_id or user_id, tools)

        config = {"configurable": {"thread_id": input_data.thread_id or user_id, "actor_id": user_id}}
        request_agent = LangGraphAGUIAgent(
            name="LangGraphSingleAgent",
            description="LangGraph single agent exposed via AG-UI",
            graph=graph,
            config=config,
        )

        try:
            async for event in request_agent.run(input_data):
                if event is not None:
                    yield event.model_dump(mode="json", by_alias=True, exclude_none=True)
        except Exception as exc:
            logging.exception("Agent run failed")
            yield RunErrorEvent(
                type="RUN_ERROR",
                message=str(exc) or type(exc).__name__,
                code=type(exc).__name__,
            ).model_dump(mode="json", by_alias=True, exclude_none=True)
        return

    # --- Original streaming path ---
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId"
        }
        return

    try:
        # Extract user ID securely from the validated JWT token
        user_id = extract_user_id_from_context(context)

        print(f"[STREAM] Starting streaming invocation for user: {user_id}, session: {session_id}")
        print(f"[STREAM] Query: {user_query}")

        # Get OAuth2 access token and create Gateway MCP client
        # The @requires_access_token decorator handles token fetching automatically
        print("[STREAM] Creating Gateway MCP client (decorator handles OAuth2)...")
        mcp_client = await create_gateway_mcp_client()
        print("[STREAM] Gateway MCP client created successfully")

        print("[STREAM] Loading Gateway tools...")
        tools = await mcp_client.get_tools()
        print(f"[STREAM] Loaded {len(tools)} tools from Gateway")
        
        # Create agent with the loaded tools
        graph = await create_langgraph_agent(user_id, session_id, tools)
        
        # Configure streaming with actor_id and thread_id for memory
        config = {
            "configurable": {
                "thread_id": session_id,
                "actor_id": user_id
            }
        }

        # Stream messages using LangGraph's astream with stream_mode="messages"
            async for event in graph.astream(
                {"messages": [("user", user_query)]},
                config=config,
                stream_mode="messages"
            ):
                # event is a tuple: (message_chunk, metadata)
                message_chunk, metadata = event
                yield message_chunk.model_dump()

            print("[STREAM] Streaming completed successfully")
            
    except Exception as e:
        error_msg = str(e) if str(e) else f"{type(e).__name__}: {repr(e)}"
        print(f"[STREAM ERROR] Error in agent_stream: {error_msg}")
        print(f"[STREAM ERROR] Exception type: {type(e).__name__}")
        traceback.print_exc()
        yield {
            "status": "error",
            "error": error_msg
        }


if __name__ == "__main__":
    app.run()
