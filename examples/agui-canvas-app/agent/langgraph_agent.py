
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



    
