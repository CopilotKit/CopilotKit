"""Canvas state schema + frontend tool reference (documentation only).

In CopilotKit v2, the **React side is the single source of truth** for
frontend tools: each `useFrontendTool({ name, parameters, handler })` call
in `src/app/page.tsx` declares the tool's schema to the runtime AND
provides the handler. The runtime forwards those declarations into the
agent's tool list at run time, so the LLM sees them automatically.

The Python functions below are NOT registered with the agent — passing them
to `create_deep_agent(tools=[...])` would cause Gemini to reject the request
with "Duplicate function declaration found: <name>". They live here as a
quick contract reference for anyone reading the agent code. The actual
schema is in `src/app/page.tsx`.

The `AgentState` TypedDict mirrors the React `AgentState` shape; canvas
state flows through CopilotKit's shared-state mechanism (`useAgent` +
`agent.setState(...)`), not via deepagents API. `create_deep_agent` does
not accept (and does not need) a `state_schema=` kwarg.
"""

from typing import Annotated, List, Literal, Optional, TypedDict
from typing_extensions import NotRequired


# --- Shared canvas state (mirrors React state on the frontend) -------------


class ChecklistItem(TypedDict):
    id: str
    text: str
    done: bool
    proposed: bool


class Item(TypedDict):
    id: str
    type: Literal["project", "entity", "note", "chart"]
    name: str
    subtitle: str
    # Union of ProjectData | EntityData | NoteData | ChartData; the canvas
    # frontend defines the per-type shape and the agent treats this as opaque.
    data: dict


class AgentState(TypedDict):
    items: List[Item]
    globalTitle: str
    globalDescription: str
    lastAction: NotRequired[str]
    itemsCreated: int
    syncSheetId: NotRequired[str]
    syncSheetName: NotRequired[str]


# --- Frontend tool contract (documentation only — NOT registered) ---------
#
# The functions below mirror the `useFrontendTool` registrations in
# `src/app/page.tsx`. They exist so reviewers can see the contract at a
# glance from the agent side. They are deliberately NOT included in
# `frontend_tool_stubs` and NOT passed to `create_deep_agent(tools=)`.
# The React side declares them to the runtime, which forwards them to the
# agent at run time.


def createItem(
    type: Annotated[str, "One of: project, entity, note, chart."],
    name: Annotated[Optional[str], "Optional item name."] = None,
) -> str:
    """Create a new canvas item and return its id."""
    return f"createItem({type}, {name})"


def deleteItem(
    itemId: Annotated[str, "Target item id."],
) -> str:
    """Delete an item by id."""
    return f"deleteItem({itemId})"


def setItemName(
    itemId: Annotated[str, "Target item id."],
    name: Annotated[str, "New item name/title."],
) -> str:
    """Set an item's name."""
    return f"setItemName({itemId}, {name})"


def setGlobalTitle(title: Annotated[str, "New global title."]) -> str:
    """Set the global canvas title."""
    return f"setGlobalTitle({title})"


def setGlobalDescription(description: Annotated[str, "New global description."]) -> str:
    """Set the global canvas description."""
    return f"setGlobalDescription({description})"


# Project actions
def setProjectField1(
    itemId: Annotated[str, "Project id."],
    value: Annotated[str, "New value for project.data.field1 (free text)."],
) -> str:
    """Set project.data.field1 (text — use this for the project's main details)."""
    return f"setProjectField1({itemId}, {value})"


def setProjectField2(
    itemId: Annotated[str, "Project id."],
    value: Annotated[
        str,
        "Priority select. Allowed: 'Option A' (high), 'Option B' (medium), 'Option C' (low).",
    ],
) -> str:
    """Set project.data.field2 (priority select)."""
    return f"setProjectField2({itemId}, {value})"


def addProjectChecklistItem(
    itemId: Annotated[str, "Project id."],
    text: Annotated[Optional[str], "Checklist text."] = None,
) -> str:
    """Append a checklist item to project.data.field4."""
    return f"addProjectChecklistItem({itemId}, {text})"


# --- Export list ----------------------------------------------------------
# Intentionally empty: tools are declared on the React side via
# `useFrontendTool` and forwarded by the runtime. See module docstring.

frontend_tool_stubs: list = []
