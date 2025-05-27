from typing import Dict, Any, List
from copilotkit.langgraph import (
    copilotkit_customize_config
)

from ag_ui.core import (RunAgentInput, Message, EventType, RunStartedEvent, RunFinishedEvent, TextMessageStartEvent, TextMessageEndEvent, TextMessageContentEvent)
from ag_ui.encoder import EventEncoder  # Encodes events to Server-Sent Events format
from langgraph.graph import Graph, END
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnableConfig

from fastapi import FastAPI
from fastapi.responses import StreamingResponse  # For streaming responses
from pydantic import BaseModel
import uvicorn
import asyncio
import os
import uuid

from crewai_implementation.agui_crew import CrewAGUIWrapper
from langgraph_agent import agent_graph

app = FastAPI()


class StateDeltaEvent(BaseModel):
    """
    Custom AG-UI protocol event for partial state updates using JSON Patch.
    
    This event allows for efficient updates to the frontend state by sending
    only the changes (deltas) that need to be applied, following the JSON Patch
    standard (RFC 6902). This approach reduces bandwidth and improves real-time
    feedback to the user.
    
    Attributes:
        type (str): Event type identifier, fixed as "STATE_DELTA"
        message_id (str): Unique identifier for the message this event belongs to
        delta (list): List of JSON Patch operations to apply to the frontend state
    """
    type: str = "STATE_DELTA"
    message_id: str
    delta: list  # List of JSON Patch operations (RFC 6902)
    
    
class StateSnapshotEvent(BaseModel):
    """
    Custom AG-UI protocol event for complete state replacement.
    
    This event replaces the entire frontend state with a new snapshot.
    It's typically used for initial state setup or when many state changes
    need to be applied at once, making a delta update inefficient.
    
    Attributes:
        type (str): Event type identifier, fixed as "STATE_SNAPSHOT"
        message_id (str): Unique identifier for the message this event belongs to
        snapshot (Dict[str, Any]): Complete state object to replace the current state
    """
    type: str = "STATE_SNAPSHOT"
    message_id: str
    snapshot: Dict[str, Any]  # Complete state object


@app.post("/langgraph-agent")
async def langgraph_agent(input_data : RunAgentInput):
    
    
    async def event_generator():
        encoder = EventEncoder()
        query = input_data.messages[-1].content
        message_id = str(uuid.uuid4())  # Generate a unique ID for this message
        
         # Signal the start of the agent run using the AG-UI protocol's RunStartedEvent
        # This indicates to the frontend that the agent has begun processing
        yield encoder.encode(
          RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=input_data.thread_id,
            run_id=input_data.run_id
          )
        )
        
        yield encoder.encode(
            StateSnapshotEvent(
                message_id=message_id,
                snapshot={
                    "status": "idle",
                    "document": ""
                }
            )
        )
        
        yield encoder.encode(
            StateDeltaEvent(
                message_id=message_id,
                delta=[
                    {
                        "op": "replace",
                        "path": "/status",
                        "value": "processing"
                    }
                ]
            )
        )
        await asyncio.sleep(2)  # Small delay to simulate work and create visual feedback
        
        agent = agent_graph()
        result = agent.invoke([HumanMessage(content=query)])
        
        print("[DEBUG] result",result)
        
        yield encoder.encode(
            StateDeltaEvent(
                message_id=message_id,
                delta=[
                    {
                        "op": "replace",
                        "path": "/status",
                        "value": "completed"
                    },
                    {
                        "op": "replace",
                        "path": "/document",
                        "value": result["document"]
                    }
                ]
            )
        )
        
        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=message_id,
                role="assistant"
            )
        )
                    
        yield encoder.encode(
            TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=message_id,
                delta=result["summary"]
            )
        )
        
        yield encoder.encode(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=message_id
            )
        )
    

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream"
    )


@app.post("/crewai-agent")
async def crewai_agent(input_data : RunAgentInput):
    
    
    async def event_generator():
        encoder = EventEncoder()
        query = input_data.messages[-1].content
        message_id = str(uuid.uuid4())  # Generate a unique ID for this message
        
         # Signal the start of the agent run using the AG-UI protocol's RunStartedEvent
        # This indicates to the frontend that the agent has begun processing
        yield encoder.encode(
          RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=input_data.thread_id,
            run_id=input_data.run_id
          )
        )
        
        yield encoder.encode(
            StateSnapshotEvent(
                message_id=message_id,
                snapshot={
                    "status": "idle",
                    "document": ""
                }
            )
        )
        
        yield encoder.encode(
            StateDeltaEvent(
                message_id=message_id,
                delta=[
                    {
                        "op": "replace",
                        "path": "/status",
                        "value": "processing"
                    }
                ]
            )
        )
        await asyncio.sleep(2)  # Small delay to simulate work and create visual feedback
        from crewai_implementation.crewai_agent import DocumentGenerationCrew
        crew_instance = DocumentGenerationCrew(topic=query)
        agent = CrewAGUIWrapper(crew_instance=crew_instance)
        result = await agent.run_with_agui(input_data.messages)
        
        print("[DEBUG] result",result)
        
        yield encoder.encode(
            StateDeltaEvent(
                message_id=message_id,
                delta=[
                    {
                        "op": "replace",
                        "path": "/status",
                        "value": "completed"
                    },
                    {
                        "op": "replace",
                        "path": "/document",
                        "value": result[0]
                    }
                ]
            )
        )
        
        yield encoder.encode(
            TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=message_id,
                role="assistant"
            )
        )
                    
        yield encoder.encode(
            TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=message_id,
                delta=result[1]
            )
        )
        
        yield encoder.encode(
            TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=message_id
            )
        )
    

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream"
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
    
    