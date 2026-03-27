import json
import os
import traceback

import boto3
from bedrock_agentcore.identity.auth import requires_access_token
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_code_interpreter import StrandsCodeInterpreterTools

from utils.auth import extract_user_id_from_context
from utils.ssm import get_ssm_parameter

app = BedrockAgentCoreApp()

# OAuth2 Credential Provider decorator from AgentCore Identity SDK.
# Automatically retrieves OAuth2 access tokens from the Token Vault (with caching)
# or fetches fresh tokens from the configured OAuth2 provider when expired.
# The provider_name references an OAuth2 Credential Provider registered in AgentCore Identity.
@requires_access_token(
    provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
    auth_flow="M2M",
    scopes=[]
)
def _fetch_gateway_token(access_token: str) -> str:
    """
    Fetch fresh OAuth2 token for AgentCore Gateway authentication.

    The @requires_access_token decorator handles token retrieval and refresh:
    1. Token Retrieval: Calls GetResourceOauth2Token API to fetch token from Token Vault
    2. Automatic Refresh: Uses refresh tokens to renew expired access tokens
    3. Error Orchestration: Handles missing tokens and OAuth flow management

    For M2M (Machine-to-Machine) flows, the decorator uses Client Credentials grant type.
    The provider_name must match the Name field in the CDK OAuth2CredentialProvider resource.

    This MUST be synchronous because it's called inside the MCPClient lambda factory.
    If it were async, the lambda would receive a coroutine object instead of a string,
    breaking authentication.
    """
    return access_token


def create_gateway_mcp_client() -> MCPClient:
    """
    Create MCP client for AgentCore Gateway with OAuth2 authentication.

    MCP (Model Context Protocol) is how agents communicate with tool providers.
    This creates a client that can talk to the AgentCore Gateway using OAuth2
    authentication. The Gateway then provides access to Lambda-based tools.

    This implementation avoids the "closure trap" by calling _fetch_gateway_token()
    inside the lambda factory. This ensures a fresh token is fetched on every MCP reconnection,
    preventing stale token errors.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    # Validate stack name format to prevent injection
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    print(f"[AGENT] Creating Gateway MCP client for stack: {stack_name}")

    # Fetch Gateway URL from SSM
    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[AGENT] Gateway URL from SSM: {gateway_url}")

    # Create MCP client with Bearer token authentication
    # CRITICAL: Call _fetch_gateway_token() INSIDE the lambda to get fresh token on reconnection
    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            url=gateway_url, headers={"Authorization": f"Bearer {_fetch_gateway_token()}"}
        ),
        prefix="gateway",
    )

    print("[AGENT] Gateway MCP client created successfully")
    return gateway_client

# ---------------------------------------------------------------------------
# CopilotKit / AG-UI integration (opt-in via AGUI_ENABLED env var)
# ---------------------------------------------------------------------------
# When enabled, the agent additionally handles AG-UI protocol requests sent by
# the CopilotKit runtime Lambda.  The original streaming path below is kept
# unchanged for the default frontend.
# ---------------------------------------------------------------------------
AGUI_ENABLED = os.environ.get("AGUI_ENABLED", "").lower() == "true"

if AGUI_ENABLED:
    import logging
    from ag_ui.core import RunAgentInput, RunErrorEvent
    from ag_ui_strands import StrandsAgent


def _is_agui_request(payload: dict) -> bool:
    """Detect AG-UI RunAgentInput by presence of threadId/runId (camelCase)."""
    return ("threadId" in payload or "thread_id" in payload) and \
           ("runId" in payload or "run_id" in payload)


def create_basic_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a basic agent with AgentCore Gateway MCP tools and memory integration.

    This function sets up an agent that can access tools through the AgentCore Gateway
    and maintains conversation memory. It handles authentication, creates the MCP client
    connection, and configures the agent with access to all tools available through
    the Gateway. If Gateway connection fails, it falls back to an agent without tools.
    """
    system_prompt = """You are a helpful assistant with access to tools via the Gateway and Code Interpreter.
    When asked about your tools, list them and explain what they do."""

    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0", temperature=0.1
    )

    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    # Configure AgentCore Memory
    agentcore_memory_config = AgentCoreMemoryConfig(
        memory_id=memory_id, session_id=session_id, actor_id=user_id
    )

    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=agentcore_memory_config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )

    # Initialize Code Interpreter tools with boto3 session
    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    session = boto3.Session(region_name=region)
    code_tools = StrandsCodeInterpreterTools(region)

    try:
        print("[AGENT] Starting agent creation with Gateway tools...")

        # Get OAuth2 access token and create Gateway MCP client
        # The @requires_access_token decorator handles token fetching automatically
        print("[AGENT] Step 1: Creating Gateway MCP client (decorator handles OAuth2)...")
        gateway_client = create_gateway_mcp_client()
        print("[AGENT] Gateway MCP client created successfully")

        print(
            "[AGENT] Step 2: Creating Agent with Gateway tools and Code Interpreter..."
        )
        agent = Agent(
            name="BasicAgent",
            system_prompt=system_prompt,
            tools=[gateway_client, code_tools.execute_python_securely],
            model=bedrock_model,
            session_manager=session_manager,
            trace_attributes={
                "user.id": user_id,
                "session.id": session_id,
            },
        )
        print(
            "[AGENT] Agent created successfully with Gateway tools and Code Interpreter"
        )
        return agent

    except Exception as e:
        print(f"[AGENT ERROR] Error creating Gateway client: {e}")
        print(f"[AGENT ERROR] Exception type: {type(e).__name__}")
        print("[AGENT ERROR] Traceback:")
        traceback.print_exc()
        print(
            "[AGENT] Gateway connection failed - raising exception instead of fallback"
        )
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the agent using streaming with Gateway integration.

    This is the function that AgentCore Runtime calls when the agent receives a request.
    It extracts the user's query from the payload, securely obtains the user ID from
    the validated JWT token in the request context, creates an agent with Gateway tools
    and memory, and streams the response back. This function handles the complete
    request lifecycle with token-level streaming. The user ID is extracted from the
    JWT token (via RequestContext).

    AG-UI path is checked FIRST so that CopilotKit requests (which have no
    prompt/runtimeSessionId) are handled correctly before the early-return guard.
    """
    # ── AG-UI path MUST come first — CopilotKit requests have no prompt/runtimeSessionId ──
    if AGUI_ENABLED and _is_agui_request(payload):
        user_id = extract_user_id_from_context(context)
        input_data = RunAgentInput.model_validate(payload)
        session_id = input_data.thread_id or user_id

        agent = create_basic_agent(user_id, session_id)
        strands_agent = StrandsAgent(
            agent=agent,
            name="CopilotKitAgent",
            description="AWS AgentCore Strands agent with AG-UI support",
        )
        strands_agent._agents_by_thread[session_id] = agent

        try:
            async for event in strands_agent.run(input_data):
                if event is not None:
                    yield event.model_dump(mode="json", by_alias=True, exclude_none=True)
        except Exception as exc:
            logging.exception("Agent run failed")
            yield RunErrorEvent(
                message=str(exc) or type(exc).__name__,
                code=type(exc).__name__,
            ).model_dump(mode="json", by_alias=True, exclude_none=True)
        return

    # ── Original streaming path ──
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {"status": "error", "error": "Missing required fields: prompt or runtimeSessionId"}
        return

    try:
        user_id = extract_user_id_from_context(context)

        print(
            f"[STREAM] Starting streaming invocation for user: {user_id}, session: {session_id}"
        )
        print(f"[STREAM] Query: {user_query}")

        agent = create_basic_agent(user_id, session_id)

        # Use the agent's stream_async method for true token-level streaming
        async for event in agent.stream_async(user_query):
            yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        print(f"[STREAM ERROR] {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
