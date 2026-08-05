"""Flow-owned backend tool lifecycle for the Beautiful Chat demo."""

from __future__ import annotations

import json

from crewai.flow.flow import Flow, start
from crewai.tools import BaseTool
from litellm import acompletion

from ag_ui_crewai import (
    CopilotKitState,
    copilotkit_emit_tool_result,
    copilotkit_stream,
)

from agents.beautiful_chat import BEAUTIFUL_CHAT_BACKSTORY, ManageTodosTool
from agents.tools.custom_tool import (
    GenerateA2uiTool,
    GetWeatherTool,
    QueryDataTool,
    ScheduleMeetingTool,
    SearchFlightsTool,
)


BACKEND_TOOLS: list[BaseTool] = [
    GetWeatherTool(),
    QueryDataTool(),
    ScheduleMeetingTool(),
    SearchFlightsTool(),
    GenerateA2uiTool(),
    ManageTodosTool(),
]
BACKEND_TOOLS_BY_NAME = {tool.name: tool for tool in BACKEND_TOOLS}


def _schema(tool: BaseTool) -> dict:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.args_schema.model_json_schema(),
        },
    }


class BeautifulChatFlow(Flow[CopilotKitState]):
    """Execute backend tools and emit their authoritative result events."""

    @start()
    async def chat(self) -> None:
        tools = [*self.state.copilotkit.actions, *map(_schema, BACKEND_TOOLS)]
        for _iteration in range(8):
            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-4o",
                    messages=[
                        {"role": "system", "content": BEAUTIFUL_CHAT_BACKSTORY},
                        *self.state.messages,
                    ],
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )
            message = response.choices[0].message
            self.state.messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                return

            for call in calls:
                function = call.get("function", {})
                backend_tool = BACKEND_TOOLS_BY_NAME.get(function.get("name"))
                if backend_tool is None:
                    # Browser-owned action: let CopilotKit execute it and
                    # resume this agent with the real result.
                    return
                try:
                    arguments = json.loads(function.get("arguments") or "{}")
                except (TypeError, json.JSONDecodeError):
                    arguments = {}
                content = backend_tool._run(**arguments)
                if not isinstance(content, str):
                    content = json.dumps(content)
                tool_call_id = call.get("id")
                self.state.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": content,
                    }
                )
                await copilotkit_emit_tool_result(tool_call_id, content)


beautiful_chat_flow = BeautifulChatFlow()
