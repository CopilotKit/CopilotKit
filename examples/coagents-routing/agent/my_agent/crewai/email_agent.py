"""Email Agent CrewAI Flow"""

import json
from typing import Any, Dict, cast
from crewai.flow.flow import Flow, start
from litellm import completion
from copilotkit.crewai import (
    copilotkit_exit,
    copilotkit_stream,
    copilotkit_predict_state
)

WRITE_EMAIL_TOOL = {
    "type": "function",
    "function": {
        "name": "write_email",
        "description": "Write an email.",
        "parameters": {
            "type": "object",
            "properties": {
                "the_email": {
                    "type": "string",
                    "description": "The email to write"
                }
            },
            "required": ["the_email"]
        }
    }
}


class EmailAgentFlow(Flow[Dict[str, Any]]):
    """
    CrewAI Flow for composing an email.
    """

    @start()
    async def compose_email(self) -> None:
        """
        Compose an email using the language model with the write_email tool.
        """

        await copilotkit_predict_state(
            {
                "email": {
                    "tool_name": "write_email",
                    "tool_argument": "the_email"
                },
            },
        )

        system_message = "You write emails."

        # Retrieve any previous messages from the state.
        messages = self.state.get("messages", [])

        # Invoke the model with a system message and any existing messages.
        response = await copilotkit_stream(
            completion(
                model="openai/gpt-4o",
                messages=[{"role": "system", "content": system_message}] + messages,
                tools=[WRITE_EMAIL_TOOL],
                stream=True,
                tool_choice="required"
            )
        )

        # Extract the tool call from the response.
        message = cast(Any, response).choices[0]["message"]
        tool_calls = message.get("tool_calls", [])
        if tool_calls:
            email = json.loads(tool_calls[0]["function"]["arguments"])["the_email"]
        else:
            email = ""

        # Exit the agent's processing.
        await copilotkit_exit()

        tool_message = {
            "role": "tool",
            "name": tool_calls[0]["function"]["name"] if tool_calls else "write_email",
            "content": email,
            "tool_call_id": tool_calls[0]["id"] if tool_calls else ""
        }

        # Update the state with the response messages and the composed email.
        self.state.setdefault("messages", []).append(message)
        self.state.setdefault("messages", []).append(tool_message)
        self.state["email"] = email
