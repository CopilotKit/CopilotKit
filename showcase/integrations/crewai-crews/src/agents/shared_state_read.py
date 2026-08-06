"""CrewAI Flow for the read-only shared recipe-state demo."""

from __future__ import annotations

import json
from typing import Any

from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import CopilotKitState, copilotkit_stream


SYSTEM_PROMPT = (
    "You are a concise recipe assistant. The frontend-owned recipe state is "
    "included below. Read it when answering, but never claim to have edited "
    "the recipe because this demo intentionally gives the agent read-only "
    "access.\n\nCurrent recipe state:\n{recipe}"
)


class SharedStateReadState(CopilotKitState):
    recipe: dict[str, Any] | None = None


class SharedStateReadFlow(Flow[SharedStateReadState]):
    """Inject the latest frontend recipe state into every model turn."""

    @start()
    async def chat(self) -> None:
        recipe = json.dumps(self.state.recipe or {}, indent=2, ensure_ascii=False)
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT.format(recipe=recipe)},
                    *self.state.messages,
                ],
                tools=self.state.copilotkit.actions,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)


shared_state_read_flow = SharedStateReadFlow()
