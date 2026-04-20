"""Claude Agent SDK (Python) backing the State Streaming demo.

Stub agent -- responds conversationally. The showcase frontend for this cell
is intentionally minimal (TODO in the original demo) so the backend just
answers the user without tools.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


TOOLS: list[dict[str, Any]] = []


SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant.
    """
).strip()


class AgentState(BaseModel):
    pass


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    return f"Unknown tool: {name}", None


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
)
