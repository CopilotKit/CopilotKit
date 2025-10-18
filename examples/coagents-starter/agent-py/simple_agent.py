#!/usr/bin/env python3
"""
Simple FastAPI agent that works with CopilotKit
"""
import os
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, Action
from openai import OpenAI

# Set up OpenAI client
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

# Define a simple action
async def say_hello(name: str) -> str:
    """Say hello to someone."""
    return f"Hello, {name}! I'm your AI assistant. How can I help you today?"

async def answer_question(question: str) -> str:
    """Answer any question using OpenAI."""
    try:
        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful AI assistant. Provide clear, concise answers."},
                {"role": "user", "content": question}
            ],
            max_tokens=500
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"Sorry, I encountered an error: {str(e)}"

# Create CopilotKit SDK
copilotkit = CopilotKitSDK(
    actions=[
        Action(
            name="say_hello",
            description="Say hello to someone",
            parameters=[
                {"name": "name", "type": "string", "description": "The name of the person to greet"}
            ],
            handler=say_hello,
        ),
        Action(
            name="answer_question", 
            description="Answer any question or have a conversation",
            parameters=[
                {"name": "question", "type": "string", "description": "The question or message from the user"}
            ],
            handler=answer_question,
        ),
    ],
)

# Add CopilotKit endpoint
add_fastapi_endpoint(app, copilotkit, "/copilotkit")

# Health check
@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    print(f"Starting agent on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)