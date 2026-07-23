"""Dedicated crew for the CopilotKit MCP Apps demo.

This crew has no bespoke tools -- the CopilotKit runtime (see
``src/app/api/copilotkit-mcp-apps/route.ts``) is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server. The runtime auto-applies the MCP Apps middleware, which exposes
the remote MCP server's tools to this agent at request time and emits the
activity events that CopilotKit's built-in ``MCPAppsActivityRenderer``
renders inline in the chat as a sandboxed iframe.

The agent therefore needs only a strong system prompt that tells the LLM
how to use the MCP-provided ``create_view`` tool that the middleware
injects on every request -- no Pydantic ``BaseTool`` is required at this
level.

Reference: showcase/integrations/langgraph-python/src/agents/mcp_apps_agent.py
"""

from __future__ import annotations

from crewai import Agent, Crew, Process, Task

from agents._chat_flow_helpers import preseed_system_prompt


CREW_NAME = "MCPApps"

MCP_APPS_BACKSTORY = (
    "You draw simple diagrams in Excalidraw via the MCP `create_view` tool "
    "exposed by the CopilotKit MCP Apps middleware. SPEED MATTERS -- "
    "produce a correct-enough diagram fast; do not optimize for polish. "
    "Target: ONE tool call, done in seconds. Use rectangles (160x70), "
    "ellipses/diamonds (120x80), 40-80px gaps; connect with arrows; "
    "include ONE cameraUpdate at the END framing the whole diagram (use "
    "approved sizes 600x450 or 800x600). Every element needs a unique "
    "string id. Reply with ONE short sentence describing what you drew. "
    "Do NOT call read_me, do NOT make multiple create_view calls, do NOT "
    "iterate or refine, do NOT add decorative colors unless the user "
    "asks. If the user asks for something specific, follow their lead -- "
    "but still in ONE call."
)


# Pre-seed the ag_ui_crewai cache so ChatWithCrewFlow skips its secondary
# description-generation LLM calls at construction time and embeds our
# verbatim guidance into build_system_message.
preseed_system_prompt(
    CREW_NAME,
    (
        "MCP Apps demo. The CopilotKit runtime injects MCP tools "
        "(notably `create_view`) at request time via the MCP Apps "
        "middleware -- you do NOT need to define them yourself. When a "
        "user asks for a diagram, call `create_view` ONCE with 3-5 "
        "elements (shapes + arrows + optional title) and a final "
        "cameraUpdate, then reply with one short sentence. No "
        "multi-call iteration."
    ),
)


def _build_crew() -> Crew:
    agent = Agent(
        role="MCP Apps Demo Assistant",
        goal=(
            "Draw simple diagrams in Excalidraw via the MCP `create_view` "
            "tool injected by the CopilotKit MCP Apps middleware."
        ),
        backstory=MCP_APPS_BACKSTORY,
        verbose=False,
        # No bespoke tools -- the MCP Apps middleware injects MCP tools
        # at request time. Frontend / runtime tools surface to the LLM via
        # ChatWithCrewFlow's tool-forwarding plumbing.
        tools=[],
    )

    task = Task(
        description=(
            "Respond to the user. When a diagram would help, call the "
            "MCP-provided `create_view` tool exactly once."
        ),
        expected_output=(
            "A short one-sentence reply alongside any rendered MCP UI surface."
        ),
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o-mini",
    )


_cached_crew: Crew | None = None


class MCPApps:
    """Adapter matching the `.crew()` + `.name` shape expected by
    ``add_crewai_crew_fastapi_endpoint``.
    """

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
