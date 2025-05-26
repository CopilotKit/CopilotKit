from fastapi import FastAPI
from fastapi.responses import StreamingResponse  # For streaming responses
import uvicorn
import asyncio
import os
from dotenv import load_dotenv  # Environment variable management
load_dotenv()  # Load environment variables from .env file

from pydantic import BaseModel  # For data validation
from typing import Dict, Any, List
import uuid
import json

from copilotkit.langgraph import (
    copilotkit_customize_config
)

from ag_ui.core import (RunAgentInput, Message, EventType, RunStartedEvent, RunFinishedEvent, TextMessageStartEvent, TextMessageEndEvent, TextMessageContentEvent)
from ag_ui.encoder import EventEncoder  # Encodes events to Server-Sent Events format
from langgraph.graph import Graph, END
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnableConfig
import openai

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

def chat_node(messages):
    system_prompt = f"""
    You are a helpful assistant for writing documents. 
    To write the document, you MUST use the write_document tool.
    After writing the document using write_document tool, 
    briefly summarize the changes you made. 2 sentences max.
    """
    
    WRITE_DOCUMENT_TOOL = {
        "type": "function",
        "function": {
            "name": "write_document",
            "description": " ".join("""
                Write a document. Use markdown formatting to format the document.
                It's good to format the document extensively so it's easy to read.
                You can use all kinds of markdown.
                However, do not use italic or strike-through formatting, it's reserved for another purpose.
                You MUST write the full document, even when changing only a few words.
                When making edits to the document, try to make them minimal - do not change every word.
                Keep stories SHORT!
                """.split()),
            "parameters": {
                "type": "object",
                "properties": {
                    "document": {
                        "type": "string",
                        "description": "The document to write"
                    },
                },
            }
        }
    }
    
    try:    
        client = openai.OpenAI()
        completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": messages[-1].content
                }
            ],
            model="gpt-4o-mini",
            tools=[WRITE_DOCUMENT_TOOL],
            tool_choice="required",
            temperature=0.5
        )
        
        # Extract the document content from the tool call
        tool_call = completion.choices[0].message.tool_calls[0]
        function_args = json.loads(tool_call.function.arguments)
        document_content = function_args['document']
        
        # Get a summary of the changes
        summary_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "Summarize the changes made to the document in 2 sentences maximum."
                },
                {
                    "role": "user",
                    "content": f"Here is the document that was created:\n\n{document_content}\n\nPlease summarize the changes made."
                }
            ],
            model="gpt-4o-mini",
            temperature=0.5
        )
        
        summary = summary_completion.choices[0].message.content
        
        # Combine document and summary
        full_response = f"{document_content}\n\n---\n\n**Summary of Changes:**\n{summary}"
        
        return { "document": document_content, "summary": summary }
        
    except Exception as e:
        print("[DEBUG] error", e)
        return [AIMessage(content="I apologize, but I encountered an error while processing your request.")]

def agent_graph():
    workflow = Graph()
    workflow.add_node("chat", chat_node)
    workflow.set_entry_point("chat")
    workflow.add_edge("chat", END)
    return workflow.compile()

app = FastAPI()

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


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
    
    

    
