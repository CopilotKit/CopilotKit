"""Native CrewAI Flow for reasoning-display demos.

The CrewAI bridge translates the OpenAI Responses API's reasoning summary and
answer stream into AG-UI reasoning and text lifecycles. This Flow deliberately
emits no protocol events itself.
"""

from __future__ import annotations

import os
import uuid

from crewai.flow.flow import Flow, start

from ag_ui_crewai import (
    CopilotKitState,
    copilotkit_responses,
    copilotkit_stream,
)
from agents.responses_reasoning import ResponsesReasoningCapture


SYSTEM_PROMPT = (
    "You are a helpful assistant. Use private reasoning and expose only a "
    "safe high-level rationale before a concise answer. If the user asks to "
    "show reasoning step by step without giving a concrete problem, compare "
    "train and car travel for a 300 km trip, summarize the decision factors, "
    "and recommend one. Never reveal hidden chain-of-thought."
)
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4")


class ReasoningFlow(Flow[CopilotKitState]):
    """Stream native model reasoning and the final answer through AG-UI."""

    @start()
    async def chat(self) -> None:
        captured = ResponsesReasoningCapture(
            await copilotkit_responses(
                model=f"openai/{REASONING_MODEL}",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *[
                        message
                        for message in self.state.messages
                        if not (
                            isinstance(message, dict)
                            and message.get("role") == "reasoning"
                        )
                    ],
                ],
                reasoning={"effort": "medium", "summary": "detailed"},
            )
        )
        response = await copilotkit_stream(captured)
        reasoning = "".join(captured.reasoning_parts)
        if reasoning:
            self.state.messages.append(
                {"id": str(uuid.uuid4()), "role": "reasoning", "content": reasoning}
            )
        self.state.messages.append(response.choices[0].message)


reasoning_flow = ReasoningFlow()
