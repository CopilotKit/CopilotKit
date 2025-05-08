"""
Persistence implementation for CrewAI flows.
"""

import json
import uuid
import copy
from typing import Any, Dict, Optional, Union
from pydantic import BaseModel
from crewai.flow.persistence.base import FlowPersistence


class InMemoryFlowPersistence(FlowPersistence):
    """
    Simple in-memory persistence for CrewAI flows.
    This is useful for development and testing but not recommended for production.
    """
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
        """Save the current flow state to memory."""
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
            # If it's not serializable, we'll create a new state dictionary with only serializable content
            serializable_dict = {}
            for key, value in state_dict.items():
                try:
                    json.dumps({key: value})
                    serializable_dict[key] = value
                except TypeError:
                    # Convert to string representation
                    if isinstance(value, (list, tuple)):
                        serializable_dict[key] = [str(item) for item in value]
                    else:
                        serializable_dict[key] = str(value)
            state_dict = serializable_dict
            
        # Store the state
        self.storage[flow_uuid] = state_dict
        
    def load_state(self, flow_uuid: str) -> Optional[Dict[str, Any]]:
        """Load the state for a given flow UUID."""
        # Check if we have the exact ID
        state = self.storage.get(flow_uuid)
        
        # Special handling for frontend's static threadId
        if not state and flow_uuid == "bcabd353-645c-4954-876d-8803e1bb57de":
            if len(self.storage) > 0:
                # Use the first available state as a starting point
                template_state = next(iter(self.storage.values()))
                # Clone and set the ID
                state = copy.deepcopy(template_state)
                state["id"] = flow_uuid
                # Save it for future use
                self.storage[flow_uuid] = state
        
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
            return json.loads(json.dumps(state))
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


# Create a singleton instance for use across the app
persistence = InMemoryFlowPersistence() 