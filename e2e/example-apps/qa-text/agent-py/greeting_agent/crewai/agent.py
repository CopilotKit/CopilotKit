"""Greet Agent CrewAI Flow"""

import json
from typing import Any, Dict, cast
from crewai.flow.flow import Flow, start, router, listen
from litellm import completion
from copilotkit.crewai import copilotkit_exit, copilotkit_stream

EXTRACT_NAME_TOOL = {
    "type": "function",
    "function": {
        "name": "ExtractNameTool",
        "description": "Extract the user's name from the message.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The user's name or UNKNOWN if the user does not provide a name"
                }
            },
            "required": ["name"]
        }
    }
}


class GreetAgentFlow(Flow[Dict[str, Any]]):
    """
    CrewAI Flow for greeting the user.
    """

    @start()
    async def start_flow(self) -> str:
        """
        Ask the user for their name.
        """
        if not self.state.get("name"):
            self.state["name"] = "UNKNOWN"

    @router(start_flow)
    async def route_flow(self) -> str:
        """
        Route the flow based on the user's name.
        """
        if self.state.get("name") == "UNKNOWN":
            if (len(self.state.get("messages", [])) > 0 and 
                self.state["messages"][-1]["role"] == "user"):
                return "route_extract_name"
            else:
                return "route_ask_name"
        return "route_greet"

    @listen("route_ask_name")
    async def ask_name(self):
        """
        Ask the user for their name.
        """
        self.state.setdefault("messages", []).append({
            "role": "assistant",
            "content": "Hey, what is your name? 🙂"
        })

    @router("route_extract_name")
    async def extract_name(self) -> str:
        """
        Check if the user's name is in the message.
        """
        last_message = self.state["messages"][-1]

        instructions = (
            f"Figure out the user's name if possible from this response they gave you: {last_message['content']}"
        )

        # Invoke the model with the conversation so far plus our instructions.
        response = await copilotkit_stream(
            completion(
                model="openai/gpt-4o",
                messages=[
                    {"role": "system", "content": instructions},
                    *self.state["messages"]
                ],
                tools=[EXTRACT_NAME_TOOL],
                tool_choice="required",
                stream=True
            )
        )

        # Extract the tool call from the model's response.
        message = cast(Any, response).choices[0]["message"]
        tool_calls = message.get("tool_calls", [])
        self.state["name"] = json.loads(tool_calls[0]["function"]["arguments"])["name"]

        if self.state["name"] != "UNKNOWN":
            return "route_greet"

        return "route_ask_name"


    @listen("route_greet")
    async def greet(self):
        """
        Greet the user by name.
        """
        await copilotkit_exit()
        greeting = "Hello, " + self.state["name"] + " 😎"
        self.state.setdefault("messages", []).append({
            "role": "assistant",
            "content": greeting
        })
        self.state["name"] = "UNKNOWN"

