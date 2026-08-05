"""CrewAI Flow for predictive, per-token shared document state."""

from __future__ import annotations

import json

from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import (
    CopilotKitState,
    StateItem,
    copilotkit_emit_tool_result,
    copilotkit_predict_state,
    copilotkit_stream,
)


SYSTEM_PROMPT = (
    "You are a collaborative writing assistant. Whenever the user asks you "
    "to write, draft, or revise text, always call write_document with the "
    "complete document. Do not paste the document into chat; the UI renders "
    "the tool argument live from shared state. After the tool result, reply "
    "with one short confirmation."
)
WRITE_DOCUMENT_TOOL = {
    "type": "function",
    "function": {
        "name": "write_document",
        "description": "Replace the shared document with complete new content.",
        "parameters": {
            "type": "object",
            "properties": {"document": {"type": "string"}},
            "required": ["document"],
        },
    },
}


class SharedStateStreamingState(CopilotKitState):
    document: str = ""


class SharedStateStreamingFlow(Flow[SharedStateStreamingState]):
    """Predict write_document arguments into state, then persist the result."""

    @start()
    async def write(self) -> None:
        await copilotkit_predict_state(
            [
                StateItem(
                    state_key="document",
                    tool="write_document",
                    tool_argument="document",
                )
            ]
        )
        tools = [*self.state.copilotkit.actions, WRITE_DOCUMENT_TOOL]
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-4o-mini",
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
        write_call = next(
            (
                call
                for call in calls
                if call.get("function", {}).get("name") == "write_document"
            ),
            None,
        )
        if write_call is None:
            return

        try:
            arguments = json.loads(
                write_call.get("function", {}).get("arguments") or "{}"
            )
        except (TypeError, json.JSONDecodeError):
            arguments = {}
        document = arguments.get("document")
        self.state.document = document if isinstance(document, str) else ""
        self.state.messages.append(
            {
                "role": "tool",
                "tool_call_id": write_call.get("id"),
                "content": "Document written to shared state.",
            }
        )
        await copilotkit_emit_tool_result(
            write_call.get("id"), "Document written to shared state."
        )

        confirmation = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-4o-mini",
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


shared_state_streaming_flow = SharedStateStreamingFlow()
