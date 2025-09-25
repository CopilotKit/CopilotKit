"""Joke Agent CrewAI Flow"""

import json
from typing import Any, Dict, cast
from crewai.flow.flow import Flow, start
from litellm import completion
from copilotkit.crewai import (
    copilotkit_exit,
    copilotkit_stream,
    copilotkit_predict_state
)


MAKE_JOKE_TOOL = {
    "type": "function",
    "function": {
        "name": "make_joke",
        "description": "Make a funny joke.",
        "parameters": {
            "type": "object",
            "properties": {
                "the_joke": {
                    "type": "string",
                    "description": "The joke to make"
                }
            },
            "required": ["the_joke"]
        }
    }
}

class JokeAgentFlow(Flow[Dict[str, Any]]):
    """
    CrewAI Flow for the Joke Agent.
    """
    
    @start()
    async def joke(self) -> None:
        
        system_message = "You make funny jokes."
        messages = self.state.get("messages", [])

        await copilotkit_predict_state(
            {
                "joke": {
                    "tool_name": "make_joke",
                    "tool_argument": "the_joke"
                }
            }
        )
        # Invoke the model with a system message and any prior messages.
        response = await copilotkit_stream(
            completion(
                model="openai/gpt-4o",
                messages=[{"role": "system", "content": system_message}] + messages,
                tools=[MAKE_JOKE_TOOL],
                stream=True
            )
        )

        # Extract the tool call from the response.
        message = cast(Any, response).choices[0]["message"]
        tool_calls = message.get("tool_calls", [])
        joke_text = ""
        if tool_calls:
            joke_text = json.loads(tool_calls[0]["function"]["arguments"])["the_joke"]

        # Exit processing.
        await copilotkit_exit()

        # Create a tool message analogous to LangGraph's ToolMessage.
        tool_message = {
            "role": "tool",
            "name": tool_calls[0]["function"]["name"] if tool_calls else "make_joke",
            "content": joke_text,
            "tool_call_id": tool_calls[0]["id"] if tool_calls else ""
        }

        # Update the state with the new messages and the composed joke.
        self.state.setdefault("messages", []).append(message)
        self.state.setdefault("messages", []).append(tool_message)
        self.state["joke"] = joke_text
