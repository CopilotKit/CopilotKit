"""Dedicated vision-capable CrewAI Flow for attachment turns."""

from __future__ import annotations

from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import CopilotKitState, copilotkit_stream


SYSTEM_PROMPT = (
    "You are a concise multimodal assistant. Inspect attached images and "
    "document text carefully, describe the relevant contents, and explicitly "
    "name the attachment modality in your answer."
)


class MultimodalFlow(Flow[CopilotKitState]):
    """Stream a vision model response from bridge-normalized content blocks."""

    @start()
    async def chat(self) -> None:
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                tools=self.state.copilotkit.actions,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


multimodal_flow = MultimodalFlow()
