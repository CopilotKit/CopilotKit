"""
Utilities for integrating CopilotKit with CrewAI
"""
from typing import Dict, List, Any, Callable
import uuid
import json
import logging

# Setup logger
logger = logging.getLogger("copilotkit.crewai.utils")

# Global variable to track interception when state modification fails
_COPILOTKIT_INTERCEPTED_ACTION = None

# Constants
COPILOTKIT_ACTION_INTERCEPTED_MARKER = "[[COPILOTKIT_ACTION_INTERCEPTED]]"


def create_copilotkit_tool_handlers(
    original_handlers: Dict[str, Callable], 
    copilotkit_actions: List[Dict[str, Any]], 
    state: Any
) -> Dict[str, Callable]:
    """
    Creates a wrapper around tool handlers that intercepts CopilotKit actions.
    
    Args:
        original_handlers: Dict of original tool handler functions
        copilotkit_actions: List of CopilotKit action definitions
        state: The flow state object where flagging will occur
        
    Returns:
        Dict of wrapped tool handler functions
    """
    # Extract action names from CopilotKit actions
    copilotkit_action_names = [
        action["function"]["name"] 
        for action in copilotkit_actions
    ]
    
    # Store action definitions by name for parameter validation
    action_definitions = {}
    for action in copilotkit_actions:
        action_name = action["function"]["name"]
        action_definitions[action_name] = action
    
    logger.debug(f"Setting up interceptors for actions: {copilotkit_action_names}")
    
    def interceptor(name):
        def handle_tool_call(**args):
            global _COPILOTKIT_INTERCEPTED_ACTION
            
            if name in copilotkit_action_names:
                logger.debug(f"Intercepting call to action: {name}")
                
                # Check for required parameters
                if name in action_definitions:
                    action_def = action_definitions[name]
                    missing_required_params = []
                    
                    # Extract required parameters from action definition
                    if "parameters" in action_def["function"]:
                        parameters = action_def["function"]["parameters"]
                        if "properties" in parameters:
                            for param_name, param_props in parameters["properties"].items():
                                # Check if parameter is required
                                is_required = False
                                if "required" in parameters and param_name in parameters["required"]:
                                    is_required = True
                                
                                # Check if required parameter is missing
                                if is_required and (param_name not in args or args[param_name] is None):
                                    missing_required_params.append(param_name)
                    
                    # If required parameters are missing, return a message asking for them
                    if missing_required_params:
                        logger.debug(f"Missing required parameters: {missing_required_params}")
                        missing_params_str = ", ".join(missing_required_params)
                        return f"I need the following information before I can proceed: {missing_params_str}. Can you please provide these details?"
                
                # 1. Always set the global variable first for maximum reliability
                _COPILOTKIT_INTERCEPTED_ACTION = {
                    "intercepted": True,
                    "name": name,
                    "args": args
                }
                
                # 2. Try to store it in the state as well for redundancy
                try:
                    # Try to store it directly in the copilotkit namespace
                    if hasattr(state.copilotkit, "__dict__"):
                        state.copilotkit.__dict__["_intercepted_action"] = True
                        state.copilotkit.__dict__["_last_intercepted_action_name"] = name
                        state.copilotkit.__dict__["_last_intercepted_action_args"] = args
                except Exception as e:
                    logger.debug(f"Failed to store intercepted state in copilotkit: {e}")
                
                # 3. Create a proper tool_call object and add it to the next message
                try:
                    # Generate a unique ID for the tool call
                    tool_call_id = str(uuid.uuid4())
                    
                    # Create a properly formatted tool call object
                    tool_call = {
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": json.dumps(args)
                        }
                    }
                    
                    # Store this tool call in state for the next message
                    if hasattr(state, "_next_message_tool_calls"):
                        state._next_message_tool_calls.append(tool_call)
                    else:
                        setattr(state, "_next_message_tool_calls", [tool_call])
                except Exception as e:
                    logger.debug(f"Failed to create tool call: {e}")
                
                # Return a special marker string that LLM response handling can detect
                # This should be a valid non-empty string so the LLM response processor doesn't break
                # but it should be replaced in the final message to the user
                return COPILOTKIT_ACTION_INTERCEPTED_MARKER
            
            # Otherwise, call the original handler
            if name in original_handlers:
                return original_handlers[name](**args)
            
            # Fallback if handler not found
            return f"No handler found for tool '{name}'"
        
        return handle_tool_call
    
    # Create a wrapped handler for each original handler
    return {name: interceptor(name) for name in set(list(original_handlers.keys()) + copilotkit_action_names)}


def check_for_intercepted_actions(state: Any) -> bool:
    """
    Checks if a CopilotKit action was intercepted during the last LLM call.
    If so, clears the flag and returns True.
    
    Args:
        state: The flow state object
        
    Returns:
        bool: True if a CopilotKit action was intercepted
    """
    global _COPILOTKIT_INTERCEPTED_ACTION
    
    # First try the copilotkit namespace approach
    try:
        if hasattr(state.copilotkit, "_intercepted_action") and state.copilotkit._intercepted_action:
            # Clear the flag but keep the action details
            state.copilotkit._intercepted_action = False
            return True
    except Exception:
        pass
        
    # Then try the global variable approach
    if _COPILOTKIT_INTERCEPTED_ACTION and _COPILOTKIT_INTERCEPTED_ACTION.get("intercepted", False):
        _COPILOTKIT_INTERCEPTED_ACTION["intercepted"] = False
        return True
        
    return False 