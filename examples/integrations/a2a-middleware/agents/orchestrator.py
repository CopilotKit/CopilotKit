"""
Orchestrator Agent - Coordinates between Research and Analysis agents.
Speaks AG-UI Protocol to the UI, delegates tasks to A2A agents via middleware.
"""

from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

import os
import uvicorn
from fastapi import FastAPI
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from google.adk.agents import LlmAgent

orchestrator_agent = LlmAgent(
    name="OrchestratorAgent",
    model="gemini-2.5-pro",
    instruction="""
    You are an orchestrator agent that coordinates research and analysis tasks.

    AVAILABLE SPECIALIZED AGENTS:

    1. **Research Agent** (LangGraph) - Gathers and summarizes information about a topic
    2. **Analysis Agent** (ADK) - Analyzes research findings and provides insights

    CRITICAL CONSTRAINTS:
    - You MUST call agents ONE AT A TIME, never make multiple tool calls simultaneously
    - After making a tool call, WAIT for the result before making another tool call
    - Do NOT make parallel/concurrent tool calls - this is not supported

    WORKFLOW FOR RESEARCH TASKS:

    When the user asks to research a topic:

    1. **Research Agent** - First, gather information about the topic
       - Pass: The user's research query or topic
       - Wait for structured JSON response with research findings

    2. **Analysis Agent** - Then, analyze the research results
       - Pass: The research results from step 1
       - Wait for structured JSON with analysis and insights

    3. Present the complete research and analysis to the user

    IMPORTANT WORKFLOW DETAILS:
    - Always call the Research Agent first to gather information
    - Then call the Analysis Agent to analyze the findings
    - Wait for each agent to complete before calling the next one
    - Build your final response using information from both agents

    RESPONSE STRATEGY:
    - After each agent response, briefly acknowledge what you received
    - Build up the complete answer incrementally
    - At the end, present a well-organized summary
    - Don't just list agent responses - synthesize them into a cohesive answer

    IMPORTANT: Once you have received a response from an agent, do NOT call that same
    agent again for the same information. Use the information you already have.
    """,
)

# Wrap with AG-UI middleware to expose via AG-UI Protocol
adk_orchestrator_agent = ADKAgent(
    adk_agent=orchestrator_agent,
    app_name="orchestrator_app",
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True
)

app = FastAPI(title="A2A Orchestrator (ADK + AG-UI Protocol)")
add_adk_fastapi_endpoint(app, adk_orchestrator_agent, path="/")

if __name__ == "__main__":
    if not os.getenv("GOOGLE_API_KEY"):
        print("⚠️  Warning: GOOGLE_API_KEY not set!")
        print("   Set it with: export GOOGLE_API_KEY='your-key-here'")
        print("   Get a key from: https://aistudio.google.com/app/apikey")
        print()

    port = int(os.getenv("ORCHESTRATOR_PORT", 9000))
    print(f"🚀 Starting Orchestrator Agent (ADK + AG-UI) on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
