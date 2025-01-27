"""
CrewAI integration for CopilotKit
"""

import json


def copilotkit_execute_action(name: str, args: dict) -> str:
    """
    Execute an action
    """
    # Flow will need a different implementation
    return json.dumps({
        "__copilotkit_execute_action__": {
            "name": name,
            "args": args
        }
    })
