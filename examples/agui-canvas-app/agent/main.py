
from fastapi import FastAPI
from fastapi.responses import StreamingResponse  # For streaming responses
from pydantic import BaseModel
import uuid
from typing import Dict, List, Any, Optional
import os
import uvicorn
import asyncio
# LangGraph imports
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.types import Command
from langgraph.checkpoint.memory import MemorySaver
from queue import SimpleQueue
# CopilotKit imports
from copilotkit import CopilotKitState, CopilotKitSDK, LangGraphAgent
from copilotkit.langgraph import (
    copilotkit_customize_config
)
from copilotkit.langgraph import (copilotkit_exit)
from copilotkit.integrations.fastapi import add_fastapi_endpoint
# OpenAI imports
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from ag_ui.core import (RunAgentInput, Message, EventType, RunStartedEvent, RunFinishedEvent, TextMessageStartEvent, TextMessageEndEvent, TextMessageContentEvent)
from ag_ui.encoder import EventEncoder  # Encodes events to Server-Sent Events format
from research_langgraph import agent_graph
from researchState import AgentState, Log, Resource
app = FastAPI()

# sdk = CopilotKitSDK(
#     agents=[
#         LangGraphAgent(
#             name="research_agent",
#             description="An agent that can help you with your research.",
#             graph=graph
#         ),
#     ]
# )

# add_fastapi_endpoint(app, sdk, "/copilotkit")

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
        event_queue = asyncio.Queue()

        def emit_event(event):
            event_queue.put_nowait(event)
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
        print("[DEBUG] input_data",input_data.messages)
        yield encoder.encode(
            StateSnapshotEvent(
                message_id=message_id,
                snapshot={
                    "research_question": input_data.state.get("research_question", ""),
                    "report": input_data.state.get("report", ""),
                    "resources": input_data.state.get("resources", []),
                    "logs": input_data.state.get("logs", [])
                }
            )
        )
        
        yield encoder.encode(
            StateDeltaEvent(
                message_id=message_id,
                delta=[
                    {
                        "op": "replace",
                        "path": "/research_question",
                        "value": query
                    }
                ]
            )
        )
        state = AgentState(research_question=query, report="", resources=[], logs=[])
        agent = await agent_graph()
        # result = await agent.ainvoke(state,config={"emit_event": emit_event, "message_id": message_id})
        
        # print("[DEBUG] result",result)
        agent_task = asyncio.create_task(
                agent.ainvoke(state, config={"emit_event": emit_event, "message_id": message_id})
            )
        while True:
            try:
                event = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                yield encoder.encode(event)
            except asyncio.TimeoutError:
                # Check if the agent is done
                if agent_task.done():
                    break
         
        # print("[DEBUG] agent_task.done()",agent_task.result())
        
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
                delta=agent_task.result().get("messages")[-1].content
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

@app.get("/")
async def root():
    return {"message": "Hello World!!"}


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )

if __name__ == "__main__":
    main()

