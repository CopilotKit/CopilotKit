from typing import Annotated, List, Optional, Dict, Any
import os
from dotenv import load_dotenv

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
from agent.prompts import SYSTEM_PROMPT
# Load environment variables early to support local development via .env
load_dotenv()


def _load_composio_tools() -> List[Any]:
    """Dynamically load Composio tools for LlamaIndex if configured.

    Reads the following environment variables:
    - COMPOSIO_API_KEY: required by Composio client; read implicitly by SDK
    - COMPOSIO_USER_ID: user/entity id to scope tools (defaults to "default")
    - COMPOSIO_TOOL_IDS: comma-separated list of tool slugs to enable (takes precedence)
    - COMPOSIO_TOOLKITS: comma-separated toolkit slugs to auto-discover from (default: "reddit")
    - COMPOSIO_TOOL_SEARCH: optional keyword to filter tools during discovery
    - COMPOSIO_TOOL_SCOPES: optional comma-separated scopes to filter toolkit tools
    - COMPOSIO_TOOL_LIMIT: optional integer limit for auto-discovery (default: 100)

    Behavior:
    - If COMPOSIO_TOOL_IDS is provided, use those exact tool slugs.
    - Otherwise, auto-discover tools from the specified toolkits (defaults to Reddit).

    Returns an empty list if not configured or if dependencies are missing.
    """
    # Import lazily to avoid hard runtime dependency if not used
    try:
        from composio import Composio  # type: ignore
        from composio_llamaindex import LlamaIndexProvider  # type: ignore
    except Exception:
        return []

    user_id = os.getenv("COMPOSIO_USER_ID", "default")

    # 1) Explicit tool IDs (highest priority)
    tool_ids_str = os.getenv("COMPOSIO_TOOL_IDS", "").strip()
    if tool_ids_str:
        tool_ids = [t.strip() for t in tool_ids_str.split(",") if t.strip()]
        if not tool_ids:
            return []
        try:
            composio = Composio(provider=LlamaIndexProvider())
            tools = composio.tools.get(user_id=user_id, tools=tool_ids)
            return list(tools) if tools is not None else []
        except Exception:
            return []

    # 2) Auto-discover from toolkits (defaults to reddit)
    toolkits_str = os.getenv("COMPOSIO_TOOLKITS", "reddit").strip()
    toolkits = [t.strip() for t in toolkits_str.split(",") if t.strip()]
    search = os.getenv("COMPOSIO_TOOL_SEARCH", "").strip() or None
    scopes_str = os.getenv("COMPOSIO_TOOL_SCOPES", "").strip()
    scopes = [s.strip() for s in scopes_str.split(",") if s.strip()] or None
    try:
        limit = int(os.getenv("COMPOSIO_TOOL_LIMIT", "100").strip())
    except Exception:
        limit = 100

    if not toolkits:
        return []

    try:
        composio = Composio(provider=LlamaIndexProvider())
        tools = composio.tools.get(
            user_id=user_id,
            toolkits=toolkits,
            search=search,
            scopes=scopes,
            limit=limit,
        )
        return list(tools) if tools is not None else []
    except Exception:
        return []



def selectAngle(
    angles: Annotated[List[str], "A list of angles from which user can select"],
) -> str:
    """Select an angle for the story."""
    return f"selectAngle({angles})"

def generateStoryAndConfirm(
    story: Annotated[str, "The story that is generated. Strictly markdown format."],
    title: Annotated[str, "The title of the story"],
    description: Annotated[str, "The description of the story"],
) -> str:
    """Generate a story and confirm it."""
    return f"generateStoryAndConfirm({story}, {title}, {description})"


_backend_tools = _load_composio_tools()

agentic_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    # Provide frontend tool stubs so the model knows their names/signatures.
    frontend_tools=[
        selectAngle,
        generateStoryAndConfirm,
    ],
    backend_tools=_backend_tools,
    system_prompt=SYSTEM_PROMPT,
    initial_state={
        # Shared state synchronized with the frontend canvas
        "story": "",
        "title": "",
        "description": "",
    },
)
