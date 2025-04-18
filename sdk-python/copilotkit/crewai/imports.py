"""
Centralized imports for CrewAI integration.

This module handles importing from different versions of CrewAI to maintain backward compatibility.
"""
from typing import Any, Dict, Optional, Union
import importlib.util

# First check if the tool_usage_events module exists
tool_usage_events_spec = importlib.util.find_spec("crewai.tools.tool_usage_events")
has_tool_usage_events = tool_usage_events_spec is not None

# Try to import from the new locations first (crewai 0.114.0+)
try:
    # Check if the new events module exists
    from crewai.events import (
        BaseEventListener,
        FlowStartedEvent,
        MethodExecutionStartedEvent,
        MethodExecutionFinishedEvent,
        FlowFinishedEvent,
        LLMCallStartedEvent,
        LLMCallCompletedEvent,
        LLMCallFailedEvent,
        LLMStreamChunkEvent,
    )
    
    # Import tool events from appropriate location
    if has_tool_usage_events:
        from crewai.tools.tool_usage_events import (
            ToolUsageStartedEvent,
            ToolUsageFinishedEvent,
            ToolUsageErrorEvent,
        )
    else:
        # Try to get them from the same module
        from crewai.events import (
            ToolUsageStartedEvent,
            ToolUsageFinishedEvent,
            ToolUsageErrorEvent,
        )
# Fall back to older import locations (pre-0.114.0)
except ImportError:
    try:
        from crewai.utilities.events import (
            BaseEventListener,
            FlowStartedEvent,
            MethodExecutionStartedEvent,
            MethodExecutionFinishedEvent,
            FlowFinishedEvent,
            LLMCallStartedEvent,
            LLMCallCompletedEvent,
            LLMCallFailedEvent,
            LLMStreamChunkEvent,
        )
        
        # Also try to get tool events from the same module
        from crewai.utilities.events import (
            ToolUsageStartedEvent,
            ToolUsageFinishedEvent, 
            ToolUsageErrorEvent,
        )
    except ImportError:
        # Define stub classes for environments without CrewAI
        class BaseEventStub:
            pass
            
        class BaseEventListener(BaseEventStub):
            async def aon_flow_started(self, event):
                pass
            
            async def aon_method_execution_started(self, event):
                pass
                
            async def aon_method_execution_finished(self, event):
                pass
                
            async def aon_flow_finished(self, event):
                pass
                
            async def aon_llm_call_started(self, event):
                pass
                
            async def aon_llm_call_completed(self, event):
                pass
                
            async def aon_llm_call_failed(self, event):
                pass
                
            async def aon_llm_stream_chunk(self, event):
                pass
        
        # Define stub event classes
        class EventStub(BaseEventStub):
            def __init__(self, **kwargs):
                for key, value in kwargs.items():
                    setattr(self, key, value)
        
        class FlowStartedEvent(EventStub):
            pass
            
        class MethodExecutionStartedEvent(EventStub):
            pass
            
        class MethodExecutionFinishedEvent(EventStub):
            pass
            
        class FlowFinishedEvent(EventStub):
            pass
            
        class LLMCallStartedEvent(EventStub):
            pass
            
        class LLMCallCompletedEvent(EventStub):
            pass
            
        class LLMCallFailedEvent(EventStub):
            pass
            
        class LLMStreamChunkEvent(EventStub):
            pass
            
        class ToolUsageStartedEvent(EventStub):
            pass
            
        class ToolUsageFinishedEvent(EventStub):
            pass
            
        class ToolUsageErrorEvent(EventStub):
            pass 