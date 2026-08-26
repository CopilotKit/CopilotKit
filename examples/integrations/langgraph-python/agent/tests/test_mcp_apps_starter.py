"""Deterministic regression coverage for the starter's Excalidraw MCP path."""

import ast
import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from ag_ui.core import EventType, Tool, UserMessage
from ag_ui.core.types import RunAgentInput
from copilotkit import CopilotKitMiddleware
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent
from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field


AGENT_ROOT = Path(__file__).resolve().parents[1]
EXCALIDRAW_ARGS = {
    "elements": [
        {
            "id": "start",
            "type": "rectangle",
            "x": 40,
            "y": 80,
            "width": 160,
            "height": 70,
            "label": {"text": "Start", "fontSize": 18},
        },
        {
            "id": "finish",
            "type": "ellipse",
            "x": 320,
            "y": 80,
            "width": 120,
            "height": 80,
            "label": {"text": "Finish", "fontSize": 18},
        },
        {
            "id": "start-finish",
            "type": "arrow",
            "x": 200,
            "y": 115,
            "width": 120,
            "height": 5,
        },
        {"type": "cameraUpdate", "width": 600, "height": 450},
    ]
}


def _system_prompt() -> str:
    tree = ast.parse((AGENT_ROOT / "main.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "SYSTEM_PROMPT"
            for target in node.targets
        ):
            return ast.literal_eval(node.value)
    raise AssertionError("main.py must define SYSTEM_PROMPT")


class ExcalidrawFakeModel(BaseChatModel):
    """Return the same create_view call through streaming and non-streaming APIs."""

    streaming: bool = False
    bound_tools: list[Any] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "excalidraw-fake-model"

    def bind_tools(self, tools, **kwargs):
        return self.__class__(streaming=self.streaming, bound_tools=list(tools))

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content="",
                        id="diagram-message",
                        tool_calls=[
                            {
                                "id": "diagram-call",
                                "name": "create_view",
                                "args": EXCALIDRAW_ARGS,
                            }
                        ],
                    )
                )
            ]
        )

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        arguments = json.dumps(EXCALIDRAW_ARGS)
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                id="diagram-message",
                tool_call_chunks=[
                    {
                        "id": "diagram-call",
                        "name": "create_view",
                        "args": "",
                        "index": 0,
                    }
                ],
            )
        )
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                id="diagram-message",
                tool_call_chunks=[{"args": arguments, "index": 0}],
            )
        )


def _create_view_tool() -> Tool:
    return Tool(
        name="create_view",
        description="Render an Excalidraw diagram",
        parameters={
            "type": "object",
            "properties": {"elements": {"type": "array", "items": {"type": "object"}}},
            "required": ["elements"],
        },
    )


def _run_starter_path(*, streaming: bool):
    graph = create_agent(
        model=ExcalidrawFakeModel(streaming=streaming),
        tools=[],
        middleware=[CopilotKitMiddleware()],
        system_prompt=_system_prompt(),
        checkpointer=InMemorySaver(),
    )
    agent = LangGraphAGUIAgent(name="fac-124", graph=graph)
    run_input = RunAgentInput(
        threadId="fac-124-thread",
        runId="fac-124-run",
        state={},
        messages=[UserMessage(id="user-message", content="Draw a flowchart")],
        tools=[_create_view_tool()],
        context=[],
        forwardedProps={},
    )

    async def collect():
        return [event async for event in agent.run(run_input)]

    return asyncio.run(collect())


def test_prompt_bounds_excalidraw_generation():
    prompt = _system_prompt()
    assert "call `create_view` ONCE" in prompt
    assert "unique string `id`" in prompt
    assert "plain `label`" in prompt
    assert "ONE `cameraUpdate` at the END" in prompt
    assert "ONE short sentence" in prompt


@pytest.mark.parametrize("streaming", [False, True])
def test_create_view_emits_one_valid_lifecycle(streaming: bool):
    events = [
        event
        for event in _run_starter_path(streaming=streaming)
        if event.type
        in {
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
        }
    ]
    assert [event.type for event in events] == [
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
    ]
    assert [event.tool_call_id for event in events] == ["diagram-call"] * 3

    payload = json.loads(events[1].delta)
    elements = payload["elements"]
    assert elements[-1]["type"] == "cameraUpdate"

    diagram_elements = elements[:-1]
    ids = [element["id"] for element in diagram_elements]
    assert len(ids) == len(set(ids))
    assert any(element["type"] == "arrow" for element in diagram_elements)
    for element in diagram_elements:
        if element["type"] != "arrow":
            assert element["label"]["text"]
