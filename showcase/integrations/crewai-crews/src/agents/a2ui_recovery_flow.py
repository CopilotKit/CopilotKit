"""CrewAI Flow that owns A2UI generation and validate/retry recovery."""

from __future__ import annotations

import json
import uuid
from typing import Any

from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import ConfigDict, Field

from ag_ui_crewai import CopilotKitState, copilotkit_stream, get_a2ui_tools


MODEL = "openai/gpt-4o"
CATALOG_ID = "declarative-gen-ui-catalog"
SYSTEM_PROMPT = (
    "You are a sales analyst. For every request, call generate_a2ui once with "
    "intent=create. The tool owns validation and retry recovery. After its "
    "result, briefly describe whether the surface rendered or fell back."
)


class A2UIRecoveryState(CopilotKitState):
    model_config = ConfigDict(populate_by_name=True)

    ag_ui: dict[str, Any] = Field(default_factory=dict, alias="ag-ui")


class A2UIRecoveryFlow(Flow[A2UIRecoveryState]):
    """Run the alpha bridge's A2UI tool and persist its result envelope."""

    @start()
    async def render(self) -> None:
        state_dict = self.state.model_dump(by_alias=True)
        schema = self.state.ag_ui.get("a2ui_schema")
        params: dict[str, Any] = {
            "model": MODEL,
            "default_catalog_id": CATALOG_ID,
            "default_surface_id": "crewai-recovery-surface",
            "recovery": {"maxAttempts": 2},
        }
        if schema:
            params["guidelines"] = {
                "composition_guide": (
                    schema if isinstance(schema, str) else json.dumps(schema)
                )
            }
        a2ui_tool = get_a2ui_tools(
            params,
            glue={"messages": list(self.state.messages), "state": state_dict},
        )
        tools = [*self.state.copilotkit.actions, a2ui_tool.schema]

        response = await copilotkit_stream(
            await acompletion(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
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
        generate_call = next(
            (
                call
                for call in calls
                if call.get("function", {}).get("name") == a2ui_tool.tool_name
            ),
            None,
        )
        if generate_call is None:
            return

        try:
            arguments = json.loads(
                generate_call.get("function", {}).get("arguments") or "{}"
            )
        except (TypeError, json.JSONDecodeError):
            arguments = {}
        result_message_id = str(uuid.uuid4())
        envelope = await a2ui_tool.run(
            arguments,
            tool_call_id=generate_call.get("id"),
            result_message_id=result_message_id,
            flow=self,
        )
        self.state.messages.append(
            {
                "id": result_message_id,
                "role": "tool",
                "tool_call_id": generate_call.get("id"),
                "content": envelope,
            }
        )

        confirmation = await copilotkit_stream(
            await acompletion(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                tools=tools,
                parallel_tool_calls=False,
                stream=True,
            )
        )
        self.state.messages.append(confirmation.choices[0].message)


a2ui_recovery_flow = A2UIRecoveryFlow()
