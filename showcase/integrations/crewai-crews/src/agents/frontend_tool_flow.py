"""CrewAI Flow for browser-owned frontend tools and generative UI actions."""

from __future__ import annotations

from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import CopilotKitState, copilotkit_stream


SYSTEM_PROMPT = (
    "You are a concise showcase assistant. When a supplied frontend tool can "
    "fulfill the user's request, you MUST call it; never claim that you lack "
    "access and never substitute a prose answer. After the browser returns a "
    "tool result, summarize it briefly."
)


class FrontendToolFlow(Flow[CopilotKitState]):
    """Stream one model step and let CopilotKit own frontend execution."""

    @start()
    async def chat(self) -> None:
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *self.state.messages,
                ],
                tools=self.state.copilotkit.actions or None,
                tool_choice=(
                    "required"
                    if self.state.copilotkit.actions
                    and self.state.messages
                    and self.state.messages[-1].get("role") == "user"
                    else "auto"
                ),
                parallel_tool_calls=False,
                stream=True,
            )
        )
        # Do not manufacture a tool result here. A streamed frontend tool call
        # ends this Flow run; CopilotKit executes it in the browser and resumes
        # with the authoritative result in the next request.
        self.state.messages.append(response.choices[0].message)


frontend_tool_flow = FrontendToolFlow()
