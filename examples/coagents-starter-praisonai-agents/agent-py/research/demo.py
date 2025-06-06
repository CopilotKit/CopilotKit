"""Demo"""

import os
import asyncio
import json
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, Agent

from research.agents import ResearchAgents


class PraisonAIAgentWrapper(Agent):
    """Wrapper to integrate PraisonAI Agents with CopilotKit"""
    
    def __init__(self, name: str, description: str):
        super().__init__(name=name, description=description)
        self.research_agents = ResearchAgents()
        self.current_state = {"status": "ready", "last_result": None}
    
    async def get_state(self, thread_id: str = None) -> dict:
        """Get the current state of the agent in CopilotKit format"""
        # Create empty message structure that CopilotKit expects
        messages = []
        
        return {
            "threadId": thread_id or "",
            "threadExists": True,  # Always return True for now (no persistence)
            "state": self.current_state,  # Return state as dict, not JSON string
            "messages": messages  # Return messages as array, not JSON string
        }
    
    async def execute(self, **kwargs):
        """Execute the agent with the given parameters - returns async generator"""
        topic = kwargs.get("topic", "AI")
        current_year = kwargs.get("current_year", "2025")
        thread_id = kwargs.get("thread_id", "")
        
        # Generate a simple run ID
        import uuid
        run_id = str(uuid.uuid4())
        
        # Emit initial state
        self.current_state["status"] = "running"
        yield self._emit_state_sync_event(
            thread_id=thread_id,
            run_id=run_id,
            node_name="research_start",
            state=self.current_state,
            running=True,
            active=True
        )
        
        # Create and run the agent system
        agent_system = self.research_agents.create_agent_system(topic, current_year)
        
        try:
            # Emit progress update
            yield self._emit_progress_event("Starting PraisonAI agent research...")
            
            # Run the agents synchronously (PraisonAI doesn't support async natively)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, agent_system.start)
            
            # Extract the result from the last task
            if hasattr(result, 'tasks') and result.tasks:
                outputs = result.tasks[-1].output if hasattr(result.tasks[-1], 'output') else str(result)
            else:
                outputs = str(result)
            
            self.current_state["status"] = "completed"
            self.current_state["last_result"] = outputs
            
            # Emit final state
            yield self._emit_state_sync_event(
                thread_id=thread_id,
                run_id=run_id,
                node_name="research_end",
                state=self.current_state,
                running=False,
                active=False
            )
            
            # Emit completion message
            yield self._emit_message_event(outputs)
            
        except Exception as e:
            error_msg = f"Error occurred: {str(e)}"
            self.current_state["status"] = "error"
            self.current_state["last_result"] = error_msg
            
            # Emit error state
            yield self._emit_state_sync_event(
                thread_id=thread_id,
                run_id=run_id,
                node_name="research_error",
                state=self.current_state,
                running=False,
                active=False
            )
            
            # Emit error message
            yield self._emit_message_event(error_msg)
    
    def _emit_state_sync_event(self, thread_id: str, run_id: str, node_name: str, 
                              state: dict, running: bool, active: bool) -> str:
        """Emit a state sync event"""
        event = {
            "event": "on_copilotkit_state_sync",
            "thread_id": thread_id,
            "run_id": run_id,
            "agent_name": self.name,
            "node_name": node_name,
            "active": active,
            "state": state,
            "running": running,
            "role": "assistant"
        }
        return json.dumps(event) + "\n"
    
    def _emit_message_event(self, content: str) -> str:
        """Emit a message event"""
        event = {
            "event": "on_llm_new_token",
            "data": {"chunk": content}
        }
        return json.dumps(event) + "\n"
    
    def _emit_progress_event(self, message: str) -> str:
        """Emit a progress event"""
        event = {
            "event": "on_custom_event",
            "name": "progress_update",
            "data": {"message": message}
        }
        return json.dumps(event) + "\n"


app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

sdk = CopilotKitRemoteEndpoint(
    agents=[
        PraisonAIAgentWrapper(
            name="research_crew",
            description="Research agent powered by PraisonAI",
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

# add new route for health check
@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "research.demo:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=(
            ["."] +
            (["../../../sdk-python/copilotkit"]
             if os.path.exists("../../../sdk-python/copilotkit")
             else []
             )
        )
    ) 