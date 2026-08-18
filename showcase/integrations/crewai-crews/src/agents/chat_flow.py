"""Neutral chat Flow for the showcase cells that differ only by prompting.

Chrome, headless, slots, CSS, auth, voice, and agent-config cells need a plain
assistant: no backend tools, no state mutations, no delegation. They used to
share the `LatestAiDevelopment` crew through
`add_crewai_crew_fastapi_endpoint`, which composes its system message with
CrewAI's `build_system_message`. That boilerplate is unconditional — it tells
the model to introduce itself and to steer the user back to the crew's purpose,
using a research-report example — so every one of those cells answered the
question and then offered to research the latest AI developments.

A regular Flow owns its own prompt, so the assistant behaves like an assistant.
`crewai-conversational-flows` wraps this same class through its conversational
registry, which keeps the two columns on one prompt.
"""

from __future__ import annotations

import json
from typing import Any

from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import CopilotKitState, copilotkit_stream


BASE_CHAT_PROMPT = (
    "You are a concise CopilotKit showcase assistant. CRITICAL: Use any "
    "frontend tools supplied by the application whenever the user asks for "
    "their capability. "
    "Honor application context and configuration included below. After the "
    "browser returns a tool result, summarize it briefly. Preserve the exact "
    "spelling of user-chosen proper names across later turns and repeat those "
    "proper names verbatim when the user asks what was chosen."
)


class PromptedChatFlow(Flow[CopilotKitState]):
    """One-turn chat Flow for showcase cells that differ only by prompting."""

    system_prompt = BASE_CHAT_PROMPT

    @start()
    async def chat(self) -> None:
        state = self.state.model_dump(exclude={"messages", "copilotkit"})
        state_context = json.dumps(state, default=str, sort_keys=True)
        actions = self.state.copilotkit.actions or None
        completion_kwargs: dict[str, Any] = {}
        if actions:
            completion_kwargs.update(
                tools=actions,
                parallel_tool_calls=False,
            )
        response = await copilotkit_stream(
            await acompletion(
                model="openai/gpt-5.4",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"{self.system_prompt}\n\n"
                            f"Application context: {state_context}"
                        ),
                    },
                    *self.state.messages,
                ],
                stream=True,
                **completion_kwargs,
            )
        )
        self.state.messages.append(response.choices[0].message)
