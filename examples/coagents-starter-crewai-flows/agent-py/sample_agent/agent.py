"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import json
from typing_extensions import Literal
from typing import Any, Dict, Optional, Union, List, cast
from pydantic import BaseModel
from litellm import completion
from crewai.flow.flow import Flow, start, router, listen
from crewai.flow.persistence import persist
from crewai.flow.persistence.base import FlowPersistence
import uuid
import copy

from copilotkit.crewai import copilotkit_stream, CopilotKitState, copilotkit_exit

class AgentState(CopilotKitState):
    """
    Here we define the state of the agent

    In this instance, we're inheriting from CopilotKitState, which will bring in
    the CopilotKitState fields. We're also adding a custom field, `language`,
    which will be used to set the language of the agent.
    """
    language: Literal["english", "spanish"] = "english"
    proverbs: List[str] = ["CopilotKit may be new, but its the best thing since sliced bread."]
    # your_custom_agent_state: str = ""

GET_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state, e.g. San Francisco, CA"
                    }
                    },
            "required": ["location"]
        }
    }
}

tools = [
    GET_WEATHER_TOOL
    # your_tool_here
]

tool_handlers = {
    "get_weather": lambda args: f"The weather for {args['location']} is 70 degrees."
    # your tool handler here
}

class InMemoryFlowPersistence(FlowPersistence):
    def __init__(self):
        self.storage = {}
        self.init_db()

    def init_db(self):
        # No actual DB initialization needed for in-memory
        pass

    def save_state(
        self,
        flow_uuid: str,
        method_name: str,
        state_data: Union[Dict[str, Any], BaseModel],
    ) -> None:
        """Save the current flow state to memory.

        Args:
            flow_uuid: Unique identifier for the flow instance
            method_name: Name of the method that just completed
            state_data: Current state data (either dict or Pydantic model)
        """
        print(f"[PERSISTENCE DEBUG] save_state called with flow_uuid: {flow_uuid}")

        # Convert state_data to dict, handling both Pydantic and dict cases
        if isinstance(state_data, BaseModel):
            state_dict = dict(state_data)
        elif isinstance(state_data, dict):
            state_dict = state_data


        # Check if we have an ID mismatch
        state_id = None
        if isinstance(state_dict, dict) and "id" in state_dict:
            state_id = state_dict["id"]
        if state_id != flow_uuid:
            # Ensure the ID matches what was passed in
            state_dict["id"] = flow_uuid

        # Special handling for proper message serialization
        if "messages" in state_dict and state_dict["messages"]:

            # Convert any Message objects to a format that's compatible with crewai_flow_messages_to_copilotkit
            serialized_messages = []
            for msg in state_dict["messages"]:
                # Start with a minimal message structure
                serialized_msg = {}

                # Handle different message types
                if hasattr(msg, "model_dump"):
                    serialized_msg = msg.model_dump()
                elif hasattr(msg, "dict"):
                    serialized_msg = msg.dict()
                elif isinstance(msg, dict):
                    serialized_msg = msg.copy()
                else:
                    # Create a basic compatible message
                    serialized_msg = {
                        "content": getattr(msg, "content", str(msg)),
                        "role": getattr(msg, "role", "assistant"),
                        "id": getattr(msg, "id", str(uuid.uuid4()))
                    }

                # Ensure necessary fields are present for crewai_flow_messages_to_copilotkit
                # Role and id are the minimum required fields
                if "role" not in serialized_msg:
                    serialized_msg["role"] = "assistant"
                if "id" not in serialized_msg:
                    serialized_msg["id"] = str(uuid.uuid4())

                # Handle tool calls - ensure they're in the format expected by crewai_flow_messages_to_copilotkit
                if "tool_calls" in serialized_msg:
                    # Check if tool_calls is None and replace with empty list if needed
                    if serialized_msg["tool_calls"] is None:
                        serialized_msg["tool_calls"] = []
                    # Now process if there are any tool calls
                    elif serialized_msg["tool_calls"]:
                        for i, tool_call in enumerate(serialized_msg["tool_calls"]):
                            if isinstance(tool_call, dict):
                                if "function" not in tool_call:
                                    tool_call["function"] = {
                                        "name": tool_call.get("name", f"tool_{i}"),
                                        "arguments": tool_call.get("arguments", "{}")
                                    }
                                elif isinstance(tool_call["function"], dict):
                                    if "arguments" in tool_call["function"] and not isinstance(tool_call["function"]["arguments"], str):
                                        tool_call["function"]["arguments"] = json.dumps(tool_call["function"]["arguments"])

                serialized_messages.append(serialized_msg)

            # Update the state with properly serialized messages
            state_dict["messages"] = serialized_messages

        # Special handling for CopilotKitProperties
        if "copilotkit" in state_dict:
            print(f"[SAVE DEBUG] Handling copilotkit property of type {type(state_dict['copilotkit']).__name__}")
            if hasattr(state_dict["copilotkit"], "model_dump"):
                state_dict["copilotkit"] = state_dict["copilotkit"].model_dump()
            elif hasattr(state_dict["copilotkit"], "dict"):
                state_dict["copilotkit"] = state_dict["copilotkit"].dict()
            elif not isinstance(state_dict["copilotkit"], dict):
                # Convert to a basic dict
                actions = getattr(state_dict["copilotkit"], "actions", [])
                # Ensure actions is not None
                if actions is None:
                    actions = []
                # Convert actions to dictionaries if needed
                serialized_actions = []
                for action in actions:
                    if hasattr(action, "model_dump"):
                        serialized_actions.append(action.model_dump())
                    elif hasattr(action, "dict"):
                        serialized_actions.append(action.dict())
                    elif isinstance(action, dict):
                        serialized_actions.append(action)
                    else:
                        serialized_actions.append({"name": str(action)})
                state_dict["copilotkit"] = {"actions": serialized_actions}

        # Final serialization test - make sure everything is JSON serializable
        try:
            json.dumps(state_dict)
        except TypeError as e:
            print(f"[SAVE DEBUG] State contains non-serializable objects: {e}")
            # If it's not serializable, we'll create a new state dictionary with only serializable content
            serializable_dict = {}
            for key, value in state_dict.items():
                try:
                    json.dumps({key: value})
                    serializable_dict[key] = value
                except TypeError:
                    print(f"[SAVE DEBUG] Non-serializable field: {key}")
                    # Convert to string representation
                    if isinstance(value, (list, tuple)):
                        serializable_dict[key] = [str(item) for item in value]
                    else:
                        serializable_dict[key] = str(value)
            state_dict = serializable_dict

        # Important: Make sure the flow_uuid from the method argument is used
        # to save the state, as this is the threadId from the frontend
        self.storage[flow_uuid] = state_dict

    def load_state(self, flow_uuid: str) -> Optional[Dict[str, Any]]:
        """Load the state for a given flow UUID.

        Args:
            flow_uuid: Unique identifier for the flow instance

        Returns:
            The state as a dictionary, or None if no state exists
        """

        # Check if we have the exact ID
        state = self.storage.get(flow_uuid)


        if not state:
            return None



        # Ensure state ID matches the flow_uuid
        if "id" in state and state["id"] != flow_uuid:
            state["id"] = flow_uuid

        # Special handling for CopilotKitProperties
        if "copilotkit" in state:
            if state["copilotkit"] is None:
                # Replace with empty dict if None
                state["copilotkit"] = {"actions": []}
            elif hasattr(state["copilotkit"], "model_dump"):
                state["copilotkit"] = state["copilotkit"].model_dump()
            elif hasattr(state["copilotkit"], "dict"):
                state["copilotkit"] = state["copilotkit"].dict()
            elif not isinstance(state["copilotkit"], dict):
                # Convert to a basic dict if it's not already
                state["copilotkit"] = {"actions": getattr(state["copilotkit"], "actions", [])}

        # Use more robust serialization
        try:
            # Try to dump it directly to JSON
            result = json.loads(json.dumps(state))
            return result
        except TypeError as e:
            # If that fails, we need to do a more manual conversion

            serializable_state = {}
            # Copy all serializable keys
            for key, value in state.items():
                try:
                    # Test if this value is JSON serializable
                    json.dumps({key: value})
                    serializable_state[key] = value
                except (TypeError, ValueError):
                    # If not serializable, convert to string representation
                    serializable_state[key] = str(value)

            return serializable_state

# Create an instance
persistence = InMemoryFlowPersistence()

@persist(persistence=persistence)
class SampleAgentFlow(Flow[AgentState]):
    """
    This is a sample flow that uses the CopilotKit framework to create a chat agent.
    """

    def __init__(self, thread_id=None, **kwargs):
        """Initialize the flow with an optional threadId."""

        # First do the standard initialization
        super().__init__(**kwargs)

        # Check what ID was automatically created
        auto_id = None
        if hasattr(self, "_state"):
            if isinstance(self._state, dict) and "id" in self._state:
                auto_id = self._state["id"]
            elif hasattr(self._state, "id"):
                auto_id = getattr(self._state, "id")

        # If thread_id is provided, ensure it's in both the state and directly in flow.state.id
        if thread_id:

            # Set it directly on the state object
            if isinstance(self.state, dict):
                self.state["id"] = thread_id
            elif hasattr(self.state, "id"):
                setattr(self.state, "id", thread_id)

            # Also set it on the underlying _state property that Flow uses internally
            if hasattr(self, "_state"):
                if isinstance(self._state, dict):
                    self._state["id"] = thread_id
                elif hasattr(self._state, "id"):
                    setattr(self._state, "id", thread_id)

    @start()
    @listen("route_follow_up")
    async def start_flow(self):
        """
        This is the entry point for the flow.
        """

        # The CopilotKit SDK's execute_flow method automatically sets state['id'] = thread_id
        # This ensures the Flow's state ID matches the threadId from the frontend


        # No need for any manual ID manipulation

    @router(start_flow)
    async def chat(self):
        """
        Standard chat node based on the ReAct design pattern. It handles:
        - The model to use (and binds in CopilotKit actions and the tools defined above)
        - The system prompt
        - Getting a response from the model
        - Handling tool calls

        For more about the ReAct design pattern, see:
        https://www.perplexity.ai/search/react-agents-NcXLQhreS0WDzpVaS4m9Cg
        """
        system_prompt = f"You are a helpful assistant. Talk in {self.state.language}. You can help users add proverbs to their collection using the 'addProverb' action. Current proverbs collected: {len(self.state.proverbs)}"

        response = await copilotkit_stream(
            completion(
                # 1.1 Specify the model to use
                model="openai/gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    *self.state.messages
                ],

                # 1.2 Bind the tools to the model
                tools=[
                    *self.state.copilotkit.actions,
                    GET_WEATHER_TOOL
                ],

                # 1.3 Disable parallel tool calls to avoid race conditions,
                #     enable this for faster performance if you want to manage
                #     the complexity of running tool calls in parallel.
                parallel_tool_calls=False,
                stream=True
            )
        )

        message = cast(Any, response).choices[0]["message"]

        # 2. Append the message to the messages in state
        self.state.messages.append(message)

        # 3. Handle tool calls
        if message.get("tool_calls"):
            tool_call = message["tool_calls"][0]
            tool_call_id = tool_call["id"]
            tool_call_name = tool_call["function"]["name"]
            tool_call_args = json.loads(tool_call["function"]["arguments"])

            # 4. Check for tool calls in the response and handle them. If the tool call
            #    is a CopilotKit action, we return the response to CopilotKit to handle
            if (tool_call_name in
                [action["function"]["name"] for action in self.state.copilotkit.actions]):

                return "route_end"

            # 5. Otherwise, we handle the tool call on the backend
            handler = tool_handlers[tool_call_name]
            result = handler(tool_call_args)

            # 6. Append the result to the messages in state
            self.state.messages.append({
                "role": "tool",
                "content": result,
                "tool_call_id": tool_call_id
            })

            # 7. Return to the follow up route to continue the conversation
            return "route_follow_up"

        # 8. If there are no tool calls, return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """
        print("SampleAgentFlow completed.")
        # Exit the agent loop
        await copilotkit_exit()