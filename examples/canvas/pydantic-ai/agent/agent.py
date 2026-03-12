import json
from typing import Any
from textwrap import dedent

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.ag_ui import StateDeps
from ag_ui.core import EventType, StateSnapshotEvent

load_dotenv()


class ChecklistItem(BaseModel):
    id: str
    text: str
    done: bool = False
    proposed: bool = False


class ProjectData(BaseModel):
    field1: str = ""
    field2: str = ""
    field3: str = ""
    field4: list[ChecklistItem] = Field(default_factory=list)
    field4_id: int = 0


class EntityData(BaseModel):
    field1: str = ""
    field2: str = ""
    field3: list[str] = Field(default_factory=list)
    field3_options: list[str] = Field(default_factory=lambda: ["Tag 1", "Tag 2", "Tag 3"])


class NoteData(BaseModel):
    field1: str = ""


class ChartMetric(BaseModel):
    id: str
    label: str
    value: int | str = 0  # 0..100 or ''


class ChartData(BaseModel):
    field1: list[ChartMetric] = Field(default_factory=list)
    field1_id: int = 0


class Item(BaseModel):
    id: str
    type: str
    name: str = ""
    subtitle: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class CanvasState(BaseModel):
    items: list[Item] = Field(default_factory=list)
    globalTitle: str = ""
    globalDescription: str = ""
    lastAction: str = ""
    itemsCreated: int = 0
    planSteps: list[dict[str, Any]] = Field(default_factory=list)
    currentStepIndex: int = -1
    planStatus: str = ""


deps = StateDeps[CanvasState]

agent = Agent(
    "openai:gpt-4.1",
    deps_type=deps,
)


@agent.tool
async def set_plan(ctx: RunContext[deps], steps: list[str]) -> StateSnapshotEvent:
    ctx.deps.state.planSteps = [{"title": s, "status": "pending"} for s in steps]
    ctx.deps.state.currentStepIndex = 0 if steps else -1
    ctx.deps.state.planStatus = "in_progress" if steps else ""
    return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=ctx.deps.state.model_dump())


@agent.tool
async def update_plan_progress(
    ctx: RunContext[deps],
    step_index: int,
    status: str,
    note: str | None = None,
) -> StateSnapshotEvent:
    steps = ctx.deps.state.planSteps
    if 0 <= step_index < len(steps):
        steps[step_index]["status"] = status
        if note:
            steps[step_index]["note"] = note
        ctx.deps.state.currentStepIndex = step_index if status == "in_progress" else ctx.deps.state.currentStepIndex
        # aggregate status
        statuses = [str(s.get("status", "")) for s in steps]
        if any(s == "failed" for s in statuses):
            ctx.deps.state.planStatus = "failed"
        elif any(s == "in_progress" for s in statuses):
            ctx.deps.state.planStatus = "in_progress"
        elif steps and all(s == "completed" for s in statuses):
            ctx.deps.state.planStatus = "completed"
    return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=ctx.deps.state.model_dump())


@agent.tool
async def complete_plan(ctx: RunContext[deps]) -> StateSnapshotEvent:
    for s in ctx.deps.state.planSteps:
        if s.get("status") != "completed":
            s["status"] = "completed"
    ctx.deps.state.planStatus = "completed"
    return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=ctx.deps.state.model_dump())


def summarize_items(state: CanvasState) -> str:
    lines: list[str] = []
    for p in state.items:
        pid = p.id
        name = p.name
        itype = p.type
        data = p.data or {}
        subtitle = p.subtitle
        summary = ""
        if itype == "project":
            f1 = data.get("field1", "")
            f2 = data.get("field2", "")
            f3 = data.get("field3", "")
            cl = ", ".join([c.get("text", "") for c in data.get("field4", [])])
            summary = f"subtitle={subtitle} · field1={f1} · field2={f2} · field3={f3} · field4=[{cl}]"
        elif itype == "entity":
            f1 = data.get("field1", "")
            f2 = data.get("field2", "")
            tags = ", ".join(data.get("field3", []) or [])
            opts = ", ".join(data.get("field3_options", []) or [])
            summary = f"subtitle={subtitle} · field1={f1} · field2={f2} · field3(tags)=[{tags}] · field3_options=[{opts}]"
        elif itype == "note":
            content = data.get("field1", "")
            summary = f"subtitle={subtitle} · noteContent=\"{content}\""
        elif itype == "chart":
            metrics = ", ".join([f"{m.get('label','')}:{m.get('value', 0)}%" for m in data.get("field1", []) or []])
            summary = f"subtitle={subtitle} · field1(metrics)=[{metrics}]"
        lines.append(f"id={pid} · name={name} · type={itype} · {summary}")
    return "\n".join(lines) if lines else "(no items)"


@agent.instructions
async def canvas_instructions(ctx: RunContext[deps]) -> str:
    s = ctx.deps.state
    items_summary = summarize_items(s)
    return dedent(
        f"""
        You are a helpful assistant managing a canvas of items (projects, entities, notes, charts).

        Ground truth (authoritative):
        - globalTitle: {s.globalTitle}
        - globalDescription: {s.globalDescription}
        - items:
        {items_summary}
        - lastAction: {s.lastAction}
        - planStatus: {s.planStatus}
        - currentStepIndex: {s.currentStepIndex}
        - planSteps: {[step.get('title', step) for step in s.planSteps]}

        Follow the FIELD SCHEMA and tool usage patterns provided by the UI. Prefer calling specific tools for updates. Keep replies concise and reflect actual state after tool calls.
        """
    )


app = agent.to_ag_ui(deps=StateDeps(CanvasState()))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
