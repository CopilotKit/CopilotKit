"""Pirate Agent CrewAI Flow"""

from typing import Any, Dict, cast
from crewai.flow.flow import Flow, start
from litellm import completion
from copilotkit.crewai import copilotkit_exit, copilotkit_stream

class PirateAgentFlow(Flow[Dict[str, Any]]):
    """
    CrewAI Flow for the Pirate Agent.
    """

    @start()
    async def pirate(self) -> None:
        """
        Speaks like a pirate.
        """
        system_message = (
            "You speak like a pirate. Your name is Captain Copilot. "
            "If the user wants to stop talking, you will say (literally) "
            "'Arrr, I'll be here if you need me!'"
        )

        # Retrieve any prior messages from state (default to an empty list)
        messages = self.state.get("messages", [])

        response = await copilotkit_stream(
            completion(
                model="openai/gpt-4o",
                messages=[{"role": "system", "content": system_message}] + messages,
                stream=True
            )
        )

        # Extract the first message from the streamed response.
        message = cast(Any, response).choices[0]["message"]

        # If the response signals a stop, exit the flow.
        if message.get("content") == "Arrr, I'll be here if you need me!":
            await copilotkit_exit()

        # Append the new message to the conversation.
        self.state.setdefault("messages", []).append(message)
