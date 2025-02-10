"""CopilotKit SDK"""
from .sdk import CopilotKitRemoteEndpoint, CopilotKitContext, CopilotKitSDK, CopilotKitSDKContext
from .action import Action
from .langgraph import CopilotKitState
from .parameter import Parameter
from .agent import Agent



__all__ = [
    'CopilotKitRemoteEndpoint', 
    'CopilotKitSDK',
    'Action', 
    'CopilotKitState',    
    'Parameter',
    'Agent',
    'CopilotKitContext',
    'CopilotKitSDKContext',
    'CrewAIAgent', # pyright: ignore[reportUnsupportedDunderAll] pylint: disable=undefined-all-variable
    'LangGraphAgent', # pyright: ignore[reportUnsupportedDunderAll] pylint: disable=undefined-all-variable
]

def __getattr__(name):
    if name == "CrewAIAgent":
        try:
            from .crewai_agent import CrewAIAgent # pylint: disable=import-outside-toplevel
            return CrewAIAgent
        except ImportError as e:
            raise ImportError(
                "CrewAIAgent requires the [crewai] extra. "
                "Please install with: pip install copilotkit[crewai]"
            ) from e
    elif name == "LangGraphAgent":
        try:
            from .langgraph_agent import LangGraphAgent # pylint: disable=import-outside-toplevel
            return LangGraphAgent
        except ImportError as e:
            raise ImportError(
                "LangGraphAgent requires the [langgraph] extra. "
                "Please install with: pip install copilotkit[langgraph]"
            ) from e
    raise AttributeError(f"module {__name__} has no attribute {name}")
