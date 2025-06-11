"""
AG-UI integration for CrewAI
This module provides classes and utilities to integrate CrewAI with AG-UI protocol
"""

from crewai import Agent, Task, Crew, Process
from typing import Dict, Any, List, Optional, Callable
from pydantic import BaseModel
import uuid
from datetime import datetime
import asyncio
from crewai_implementation.crewai_agent import DocumentGenerationCrew
class CrewAGUIWrapper:
    """
    Wrapper class to integrate CrewAI with AG-UI protocol
    This allows for real-time observability and state management when running CrewAI tasks
    """
    def __init__(self, crew_instance, event_callback: Optional[Callable] = None):
        """
        Initialize the wrapper with a CrewAI crew instance and an optional callback for events
        
        Args:
            crew_instance: A CrewAI Crew instance
            event_callback: Optional callback function that will be called with AG-UI protocol events
        """
        self.crew = crew_instance
        self.event_callback = event_callback
        self.message_id = str(uuid.uuid4())
        
        self.state = {
            "status": "idle",
            "document" : ""
        }
        
        # Hook into CrewAI events if possible
        # This is a placeholder for future CrewAI event integration
    async def run_with_agui(self, inputs: Dict[str, Any]):
        """
        Run the CrewAI crew with AG-UI protocol integration following the CrewAI task workflow:
        1. search_restaurants_task: Restaurant Research Specialist gathers detailed information
        2. present_recommendations_task: Restaurant Recommendation Specialist formats results
        3. respond_to_feedback_task: Handle user feedback on recommendations (called separately)
        
        Args:
            inputs: Input parameters for the CrewAI crew
            
        Returns:
            The result from the CrewAI crew
        """
        # Initialize state
        self._update_state([
            {
                "op": "replace",
                "path": "/status",
                "value": "processing"
            }
        ])
        topic = inputs[-1].content
        # Allow a brief delay for initialization state to register
        await asyncio.sleep(0.5)
        crew = DocumentGenerationCrew(topic)
        researcher = crew.create_researcher()
        summarizer = crew.create_summarizer()
        tasks = crew.create_tasks(researcher, summarizer)
        
        document_crew = Crew(
            agents=[researcher, summarizer],
            tasks=tasks,
            process=Process.sequential,
            verbose=True
        )
        result = document_crew.kickoff()
        print("[DEBUG] result",result)
        # parts = result.split("\n\n")
        document = result.tasks_output[0].raw
        summary = result.raw
        self.state["document"] = document
        self.state["summary"] = summary
        self._update_state([
            {
                "op": "replace",
                "path": "/status",
                "value": "completed"
            },
            {
                "op": "replace",
                "path": "/document",
                "value": document
            }
        ])
        return [document, summary]
    

    
    # AG-UI protocol state management methods
    def _update_state(self, deltas: List[Dict[str, Any]]):
        """
        Update the state and emit a state delta event
        
        Args:
            deltas: List of JSON Patch operations
        """
        # Check if state exists, and initialize it if not
        if not self.state or not isinstance(self.state, dict):
            print("Warning: Reinitializing empty state before applying updates")
            self.state = {
                "status": {
                    "phase": "initialized",
                    "error": None,
                    "timestamp": datetime.now().isoformat()
                },
                "search": {
                    "query": "",
                    "location": "",  
                    "stage": "not_started",
                    "restaurants_found": 0,
                    "restaurants": [],
                    "completed": False
                },            
                "processing": {
                    "progress": 0,
                    "recommendations": None,
                    "completed": False,
                    "inProgress": False,
                    "feedback": None,
                    "currentPhase": "",
                    "phases": ["search", "recommend", "feedback"]
                },
                "ui": {
                    "showRestaurants": False,
                    "showProgress": True,
                    "activeTab": "chat",
                    "showFeedbackPrompt": False,                
                    "feedbackOptions": []
                }
            }
            
        # Log important state changes like phase transitions
        for delta in deltas:
            if delta.get("path") == "/status/phase":
                print(f"\n==== STATE PHASE CHANGE: '{delta.get('value')}' ====\n")
                
        # Actually apply patches to internal state
        filtered_deltas = []
        for delta in deltas:
            try:
                path_parts = delta["path"].strip("/").split("/")
                current = self.state
                  # Navigate to the parent object, creating nested objects if they don't exist
                for i in range(len(path_parts) - 1):
                    part = path_parts[i]
                    if part not in current:
                        current[part] = {}
                    current = current[part]
                
                # Apply the operation based on type
                op = delta.get("op", "replace")  # Default to replace
                last_key = path_parts[-1]
                
                if op == "replace":
                    current[last_key] = delta["value"]
                    filtered_deltas.append(delta)
                elif op == "add":
                    if isinstance(current, list):
                        current.append(delta["value"])
                    else:
                        current[last_key] = delta["value"]
                    filtered_deltas.append(delta)
                elif op == "remove":
                    if last_key in current:
                        del current[last_key]
                        filtered_deltas.append(delta)
            except Exception as e:
                print(f"Failed to apply state update: {str(e)}, delta: {delta}")        # Emit state delta event if callback is provided and we have valid deltas
        if self.event_callback and filtered_deltas:
            # Check if this contains any important phase changes
            important_phase_changes = [d for d in filtered_deltas if d.get("path") == "/status/phase"]
            if important_phase_changes:
                for phase_change in important_phase_changes:
                    current_phase = phase_change.get("value")
                    print(f"EMITTING IMPORTANT PHASE CHANGE: {current_phase}")
                
                # Add explicit progress update for visibility of phase
                if any(d.get("value") == "restaurants_found" for d in important_phase_changes):
                    print("Adding explicit progress update for restaurants_found phase")
                    filtered_deltas.append({
                        "op": "replace",
                        "path": "/processing/progress",
                        "value": 0.5
                    })
                elif any(d.get("value") == "presenting_recommendations" for d in important_phase_changes):
                    print("Adding explicit progress update for presenting_recommendations phase")
                    filtered_deltas.append({
                        "op": "replace",
                        "path": "/processing/progress",
                        "value": 0.7
                    })
            
            # Emit the state delta event
            self.event_callback({
                "type": "STATE_DELTA",
                "message_id": self.message_id,
                "delta": filtered_deltas
            })
    # AG-UI protocol event emission methods
    def _emit_tool_call(self, tool_name: str, args: Dict[str, Any], task_type: str = None):
        """
        Emit tool call events with task tracking
        
        Args:
            tool_name: Name of the tool/task
            args: Tool/task arguments
            task_type: The type of task (search, recommend, feedback)
        """
        if not self.event_callback:
            return
        
        # If this is a search-related tool call, ensure location is properly extracted
        if "search" in tool_name.lower() and "location" in args:
            location = args.get("location", "")
            print(f"Checking location parameter: '{location}'")
            
            # If location looks like JSON, try to extract actual location
            if isinstance(location, str) and location and (location.startswith('{') and location.endswith('}')):
                try:
                    import json
                    location_data = json.loads(location)
                    if isinstance(location_data, dict):
                        if "originalLocation" in location_data:
                            args["location"] = location_data["originalLocation"]
                            print(f"Extracted location from JSON parameter: '{args['location']}'")
                        elif "feedbackText" in location_data and "originalLocation" in location_data:
                            args["location"] = location_data["originalLocation"]
                            print(f"Extracted location from feedback JSON: '{args['location']}'")
                except (json.JSONDecodeError, TypeError):
                    # Not valid JSON, keep as is
                    print(f"Location parameter appears to be JSON but could not be parsed: '{location}'")
        
        # Debug log
        print(f"EMITTING TOOL CALL: {tool_name} with args: {args} (task_type: {task_type})")
        
        # Generate a tool call ID
        tool_call_id = f"call_{str(uuid.uuid4())[:8]}"
        
        # Map task names to types if not provided
        if task_type is None:
            if "search" in tool_name.lower():
                task_type = "search"
            elif "recommend" in tool_name.lower() or "present" in tool_name.lower():
                task_type = "recommend"
            elif "feedback" in tool_name.lower() or "respond" in tool_name.lower():
                task_type = "feedback"
        
        # Update current phase in state based on task type
        if task_type:
            self._update_state([{
                "op": "replace",
                "path": "/processing/currentPhase",
                "value": task_type
            }])
        
        # Format display name for the tool call
        display_name = tool_name
        if task_type:
            task_type_display = {
                "search": "Restaurant Search",
                "recommend": "Recommendation Generation",
                "feedback": "Feedback Processing"
            }.get(task_type, task_type.capitalize())
            display_name = f"{task_type_display} Task"
            
        # Tool call start
        self.event_callback({
            "type": "TOOL_CALL_START",
            "message_id": self.message_id,
            "toolCallId": tool_call_id,
            "toolCallName": display_name,
            "tool": tool_name
        })
        
        # Tool call args
        self.event_callback({
            "type": "TOOL_CALL_ARGS",
            "message_id": self.message_id,
            "toolCallId": tool_call_id,
            "toolCallName": tool_name,
            "args": args
        })
        
        # Tool call end
        self.event_callback({
            "type": "TOOL_CALL_END",
            "message_id": self.message_id,
            "toolCallId": tool_call_id,
            "toolCallName": tool_name
        })
    
    def _emit_text_message(self, content: str):
        """
        Emit text message events following AG-UI protocol
        
        Args:
            content: The text content to send
        """
        if not self.event_callback:
            return
        
        # Text message start event
        self.event_callback({
            "type": "TEXT_MESSAGE_START",
            "message_id": self.message_id,
            "role": "assistant"
        })
        
        # Text message content event
        self.event_callback({
            "type": "TEXT_MESSAGE_CONTENT",
            "message_id": self.message_id,
            "delta": content  # Important: delta must be a string
        })
        
        # Text message end event
        self.event_callback({
            "type": "TEXT_MESSAGE_END",
            "message_id": self.message_id,
            "delta": ""  # Important: delta must be a string, even if empty
        })
    