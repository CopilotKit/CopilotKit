#!/usr/bin/env python
from typing import Dict, Any, List, Optional, Generic
import datetime
from crewai.flow import Flow
from crewai import LLM
from crewai.utilities.events import crewai_event_bus
import logging
from crewai.utilities.events.base_events import BaseEvent
from pydantic import Field
from typing import TypeVar
from pydantic import BaseModel

# Define a generic type variable for the state
S = TypeVar('S')

logger = logging.getLogger(__name__)

# Tool calls log for tracking
tool_calls_log = []

class FlowInputState(BaseModel):
    """Defines the expected input state for the AgenticChatFlow."""
    messages: List[Dict[str, str]] = [] # Current message(s) from the user
    tools: List[Dict[str, Any]] = [] # CopilotKit tool format: name, description, parameters
    conversation_history: List[Dict[str, str]] = [] # Full conversation history (persisted between runs)


class CopilotKitToolCallEvent(BaseEvent):
    """Event emitted when a tool call is made through CopilotKit"""
    type: str = "copilotkit_frontend_tool_call"

    tool_name: str
    args: Dict[str, Any]
    timestamp: str = Field(default_factory=lambda: datetime.datetime.now().isoformat())

    def __init__(self, **data):
        # If timestamp is not provided, it will use the default_factory
        super().__init__(**data)

class CopilotKitStateUpdateEvent(BaseEvent):
    """Event for state updates in CopilotKit"""
    type: str = "copilotkit_state_update"
    tool_name: str
    args: dict[str, Any]
    timestamp: str = Field(default_factory=lambda: datetime.datetime.now().isoformat())

    def __init__(self, **data):
        # If timestamp is not provided, it will use the default_factory
        super().__init__(**data)

def create_tool_proxy(tool_name):
    def tool_proxy(**kwargs):
        event = CopilotKitToolCallEvent(tool_name=tool_name, args=kwargs)
        tool_calls_log.append({
            "tool_name": tool_name,
            "args": kwargs,
            "timestamp": event.timestamp
        })
        assert hasattr(crewai_event_bus, "emit")
        logger.info(f"create_tool_proxy: Emitting tool call event for {tool_name} with parameters: {kwargs}")
        crewai_event_bus.emit(None, event=event)
        return f"\n\nTool {tool_name} called successfully with parameters: {kwargs}\n\n"
    return tool_proxy

class CopilotKitFlow(Flow[S], Generic[S]): # Make it generic
    _tools_from_input: List[Dict[str, Any]] = [] # Store raw tool definitions

    def __class_getitem__(cls, item):
        # Pass type info down to Flow's __class_getitem__
        super().__class_getitem__(item)
        cls._initial_state_T = item
        return cls

    def kickoff(self, state: Optional[S] = None, inputs: Optional[Dict[str, Any]] = None):
        # CrewAI's Flow class initializes self.state from the 'state' parameter or
        # by instantiating S using 'inputs' if 'state' is None and 'inputs' is a dict.
        # We need to ensure tools from 'inputs' (if any) are captured if not part of S's direct fields
        # or if S is initialized before this kickoff by CrewAI.

        # If inputs dict contains 'tools', store them for get_available_tools
        if isinstance(inputs, dict) and "tools" in inputs:
             # Be careful with class-level _tools_from_input if multiple instances run concurrently
             # It might be better to store this on self.
            CopilotKitFlow._tools_from_input = inputs.get("tools", [])
            print(f"Tools from inputs dict: {CopilotKitFlow._tools_from_input}")

        # The actual_input for super().kickoff should be the state model instance S
        # or the dict 'inputs' if state is None.
        # The base Flow's kickoff will handle initializing self.state.
        # If state is already an instance of S, pass it.
        # If state is None and inputs is a dict, Flow.__init__ will use inputs to create S.

        # Let the base Flow handle state initialization.
        # Our main job here is to potentially intercept 'inputs' if it has a structure
        # not directly mapping to S (e.g., tools in a separate key).
        # However, with AgentInputState having 'tools', this should be cleaner.

        # Call parent's kickoff - note that base Flow.kickoff() only accepts 'inputs'
        # If state is not None, we should convert it to dict and use as inputs
        if state is not None and inputs is None:
            # If we have a state model instance but no inputs, convert state to dict for inputs
            if hasattr(state, "dict") and callable(getattr(state, "dict")):
                inputs_dict = state.dict()
                result = super().kickoff(inputs=inputs_dict)
            else:
                # If state can't be converted via .dict(), use it directly as inputs
                result = super().kickoff(inputs=state)
        else:
            # Normal case: just pass inputs (which might be None)
            result = super().kickoff(inputs=inputs)

        return result # Return what the base Flow.kickoff returns

    def get_message_history(self, system_prompt: Optional[str] = None, max_messages: int = 20) -> List[Dict[str, str]]:
        messages: List[Dict[str, str]] = []

        # PRIORITIZE conversation_history if available (for persistence between runs)
        if hasattr(self.state, "conversation_history") and isinstance(self.state.conversation_history, list) and self.state.conversation_history:
            # If we have conversation history, use it as the primary source of messages
            messages.extend(self.state.conversation_history)
            logger.info(f"get_message_history: Loaded {len(self.state.conversation_history)} messages from conversation history")

            # If there are new messages not in the history, add them temporarily (they'll be saved to history later)
            if hasattr(self.state, "messages") and isinstance(self.state.messages, list):
                for msg in self.state.messages:
                    if msg not in messages:
                        messages.append(msg)
                        logger.info(f"get_message_history: Added new message (not yet in history): {msg.get('content', '')[:30]}...")

        # If no conversation history, try current messages
        elif hasattr(self.state, "messages") and isinstance(self.state.messages, list):
            messages.extend(self.state.messages)
            print(f"get_message_history: Loaded {len(self.state.messages)} messages from current messages")

        # Fallback for raw input if state isn't populated as expected (less ideal)
        elif hasattr(self, "_raw_input") and isinstance(self._raw_input, dict) and "messages" in self._raw_input:
            messages.extend(self._raw_input["messages"])
            logger.info(f"get_message_history: Loaded {len(self._raw_input['messages'])} messages from _raw_input")

        # Add system prompt if needed
        if system_prompt:
            # Check if we already have a system message
            has_system_message = any(msg.get('role') == 'system' for msg in messages)

            if not has_system_message:
                # Add system message at the beginning
                messages.insert(0, {"role": "system", "content": system_prompt})
                logger.info(f"get_message_history: Added system prompt message")

        # Limit to max_messages, but keep the system message if present
        if len(messages) > max_messages:
            # If first message is system message, keep it and take the (max_messages-1) most recent messages
            if messages and messages[0].get('role') == 'system':
                system_msg = messages[0]
                recent_msgs = messages[-(max_messages-1):]
                messages = [system_msg] + recent_msgs
                logger.info(f"get_message_history: Truncated to {len(messages)} messages (including system message)")
            else:
                # Otherwise just take most recent messages
                messages = messages[-max_messages:]
                logger.info(f"get_message_history: Truncated to {len(messages)} most recent messages")

        return messages

    def get_available_tools(self) -> List[Dict[str, Any]]:
        raw_tools: List[Dict[str, Any]] = []

        # Primary source: self.state.tools (from AgentInputState)
        if hasattr(self.state, "tools") and isinstance(self.state.tools, list):
            raw_tools = self.state.tools
            logger.info(f"get_available_tools: Loaded {len(raw_tools)} tools from self.state.tools")

        # Fallback to _tools_from_input (populated in kickoff from raw 'inputs' dict)
        # This is useful if 'tools' was passed separately and not as part of the state model S.
        elif CopilotKitFlow._tools_from_input:
            raw_tools = CopilotKitFlow._tools_from_input
            logger.info(f"get_available_tools: Loaded {len(raw_tools)} tools from _tools_from_input")

        # Fallback for raw input (less ideal)
        elif hasattr(self, "_raw_input") and isinstance(self._raw_input, dict) and "tools" in self._raw_input:
            raw_tools = self._raw_input["tools"]
            logger.info(f"get_available_tools: Loaded {len(raw_tools)} tools from _raw_input")

        return raw_tools

    def format_tools_for_llm(self, tools_definitions: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], Dict[str, callable]]:
        formatted_tools = []
        available_functions = {}

        logger.info(f"format_tools_for_llm: Processing {len(tools_definitions)} tool definitions.")
        for tool_def in tools_definitions:
            if "name" in tool_def and "parameters" in tool_def and "description" in tool_def:
                # Standard OpenAI tool format
                formatted_tool = {
                    "type": "function",
                    "function": {
                        "name": tool_def["name"],
                        "description": tool_def["description"],
                        "parameters": tool_def["parameters"]
                    }
                }
                formatted_tools.append(formatted_tool)

                # Create and store the proxy function
                tool_name = tool_def["name"]
                available_functions[tool_name] = create_tool_proxy(tool_name)
                logger.info(f"format_tools_for_llm: Created proxy for tool: {tool_name}")
            else:
                logger.info(f"format_tools_for_llm: Skipped invalid tool definition: {tool_def.get('name', 'N/A')}")

        return formatted_tools, available_functions

    def handle_tool_responses(
        self,
        llm: LLM,
        response_text: str, # Changed from 'response' to 'response_text' for clarity
        messages: List[Dict[str, str]],
        tools_called_count_before_llm_call: int, # More descriptive name
        follow_up_prompt: Optional[str] = None
    ) -> str:
        new_tools_called_during_interaction = len(tool_calls_log) > tools_called_count_before_llm_call

        # Check if a follow-up is needed (tools were called but no substantive natural language content)
        need_followup = new_tools_called_during_interaction and (
            not response_text.strip() or
            all(f"Tool {call['tool_name']}" in response_text for call in tool_calls_log[tools_called_count_before_llm_call:])
        )

        if need_followup:
            logger.info("handle_tool_responses: Follow-up needed after tool call.")
            follow_up_messages = messages.copy()
            # Add the assistant's response that included tool calls (or was just tool call confirmations)
            follow_up_messages.append({"role": "assistant", "content": response_text})

            # Add tool call results as messages (CopilotKit might do this differently, adjust if needed)
            # For OpenAI, tool results are typically added with role 'tool'
            # This part might need alignment with how CopilotKit expects tool results to be fed back.
            # The current [create_tool_proxy](cci:1://file:///Users/croonnicola/Downloads/agentic_chat/src/agentic_chat/copilotkit_integration.py:22:0-42:21) returns a string. This string becomes the 'content'
            # of the assistant's message. If the LLM needs explicit tool result messages,
            # this needs adjustment. For now, we assume the proxy's string output is sufficient.

            prompt_for_final_answer = follow_up_prompt or "Tools have been called. Continue with your response."
            follow_up_messages.append({"role": "user", "content": prompt_for_final_answer})

            logger.info(f"handle_tool_responses: Calling LLM for follow-up with {len(follow_up_messages)} messages.")
            # Call LLM without tools for a final natural language response
            final_response_text = llm.call(messages=follow_up_messages, tools=None, available_functions=None)

            # Combine initial tool call confirmations with the final natural language response
            # This behavior might need tuning based on desired output verbosity
            # combined_response = response_text + "\n\n" + final_response_text
            # Often, you just want the final_response_text
            return final_response_text
        else:
            return response_text # No follow-up needed, return original LLM response

    def get_tools_summary(self) -> str: # Remains the same
        summary = f"\nTotal tool calls: {len(tool_calls_log)}\n"
        for i, call in enumerate(tool_calls_log):
            summary += f"\n[{i+1}] Tool: {call['tool_name']}"
            summary += f"\n    Args: {call['args']}"
            summary += f"\n    Time: {call['timestamp']}\n"
        return summary

# Register event listener (remains the same)
def register_tool_call_listener():
    @crewai_event_bus.on(CopilotKitToolCallEvent)
    def on_tool_call_event(source, event):
        print(f"Received CopilotKit tool call event: Tool: {event.tool_name}, Args: {event.args}, Time: {event.timestamp}")
        pass

# Use this function to emit state updates to the client UI (STATE_SNAPSHOT)
# This is particularly useful when you need to update the UI state from within a tool call
# or when you want to reflect state changes in the AG-UI interface
# Example: emit_copilotkit_state_update_event("write_document", {"document": state.data["document"]})
def emit_copilotkit_state_update_event(tool_name: str, args: dict[str, Any]):
    event = CopilotKitStateUpdateEvent(tool_name=tool_name, args=args)
    crewai_event_bus.emit(None, event=event)