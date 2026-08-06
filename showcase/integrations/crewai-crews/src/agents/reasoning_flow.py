"""Native CrewAI Flow for reasoning-display demos.

The alpha bridge translates the OpenAI Responses API's reasoning summary and
answer stream into AG-UI reasoning and text lifecycles. This Flow deliberately
emits no protocol events itself.
"""

from __future__ import annotations

import os

from crewai.flow.flow import Flow, start

from ag_ui_crewai import (
    CopilotKitState,
    copilotkit_responses,
    copilotkit_stream,
)


SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer."
)
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5.4")


class ReasoningFlow(Flow[CopilotKitState]):
    """Stream native model reasoning and the final answer through AG-UI."""

    @start()
    async def chat(self) -> None:
        response = await copilotkit_stream(
            await copilotkit_responses(
                model=f"openai/{REASONING_MODEL}",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                reasoning={"effort": "medium", "summary": "detailed"},
            )
        )
        self.state.messages.append(response.choices[0].message)


reasoning_flow = ReasoningFlow()
