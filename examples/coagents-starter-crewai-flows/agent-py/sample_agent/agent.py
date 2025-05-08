"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from typing_extensions import Literal
from crewai import LLM
from crewai.flow.flow import Flow, start, router, listen
from crewai.flow.persistence import persist

from copilotkit.crewai import (
    CopilotKitState, 
    copilotkit_exit, 
    create_copilotkit_tool_handlers,
    check_for_intercepted_actions,
    COPILOTKIT_ACTION_INTERCEPTED_MARKER
)

# Import the persistence from our dedicated module
from .persistence import persistence

class AgentState(CopilotKitState):
    """
    Here we define the state of the agent

    In this instance, we're inheriting from CopilotKitState, which will bring in
    the CopilotKitState fields. We're also adding a custom field, `language`,
    which will be used to set the language of the agent.
    """
    language: Literal["english", "spanish"] = "english"
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
]

@persist(persistence=persistence)
class SampleAgentFlow(Flow[AgentState]):
    """
    This is a sample flow that uses the CopilotKit framework to create a chat agent.
    """
    
    def __init__(self, thread_id=None, **kwargs):
        """Initialize the flow with an optional threadId."""
        # First do the standard initialization
        super().__init__(**kwargs)
        
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
        pass

    @router(start_flow)
    @listen("route_follow_up")
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
        system_prompt = f"You are a helpful assistant. Talk in {self.state.language}."

        llm = LLM(
             # 1.1 Specify the model to use
            model="openai/gpt-4o",

            # 1.2 Disable parallel tool calls to avoid race conditions,
            #     enable this for faster performance if you want to manage
            #     the complexity of running tool calls in parallel.
            parallel_tool_calls=False,

            # 1.3 Stream the response
            stream=True
        )
        
        # 1. Run the model and stream the response
        response = llm.call(
            messages = [
                {
                    "role": "system", 
                    "content": system_prompt
                },
                *self.state.messages
            ],

            # 1.4 Bind the tools to the model
            tools = [
                *self.state.copilotkit.actions,
                GET_WEATHER_TOOL
            ],
            available_functions = create_copilotkit_tool_handlers(
                original_handlers={
                    "get_weather": lambda location: f"The weather for {location} is 90 degrees."
                },
                copilotkit_actions=self.state.copilotkit.actions,
                state=self.state
            )
        )

        # Check for the special case when an action was intercepted 
        from copilotkit.crewai.utils import _COPILOTKIT_INTERCEPTED_ACTION
        if COPILOTKIT_ACTION_INTERCEPTED_MARKER in response:
            # Explicitly call check_for_intercepted_actions to sync state
            check_for_intercepted_actions(self.state)
            
            # Replace the special marker with empty string
            response = response.replace(COPILOTKIT_ACTION_INTERCEPTED_MARKER, "").strip()
            
            # Create the message with tool_calls if available
            if hasattr(self.state, "_next_message_tool_calls") and self.state._next_message_tool_calls:
                message = {
                    "role": "assistant", 
                    "content": response,  # Include any remaining response after removing the marker
                    "tool_calls": self.state._next_message_tool_calls
                }
                # Clear the tool calls to avoid reuse
                self.state._next_message_tool_calls = []
            else:
                # Fallback approach: reconstruct from the global variable
                if _COPILOTKIT_INTERCEPTED_ACTION is not None:
                    action_name = _COPILOTKIT_INTERCEPTED_ACTION.get("name", "unknown_action")
                    action_args = _COPILOTKIT_INTERCEPTED_ACTION.get("args", {})
                    
                    import uuid
                    import json
                    tool_call = {
                        "id": str(uuid.uuid4()),
                        "type": "function",
                        "function": {
                            "name": action_name,
                            "arguments": json.dumps(action_args)
                        }
                    }
                    message = {
                        "role": "assistant",
                        "content": response,
                        "tool_calls": [tool_call]
                    }
                else:
                    # Last resort
                    message = {"role": "assistant", "content": response or ""}
            
            # Add the message to state
            self.state.messages.append(message)
            
            # Short-circuit and return immediately
            return "route_end"

        # Normal case - create a message with the response content
        message = {"role": "assistant", "content": response}

        # 2. Append the message to the messages in state
        self.state.messages.append(message)

        # 3. Check if a CopilotKit action was intercepted
        if check_for_intercepted_actions(self.state):
            return "route_end"

        # 4. Return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """
        # Exit the agent loop
        await copilotkit_exit()