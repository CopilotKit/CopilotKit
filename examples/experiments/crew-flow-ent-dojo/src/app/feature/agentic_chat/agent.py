#!/usr/bin/env python
from dotenv import load_dotenv
from crewai.flow import start
from crewai import LLM
from pydantic import BaseModel
from typing import List, Dict
from crewai.flow import persist

# Import from copilotkit_integration
from copilotkit.crewai import (
    CopilotKitFlow,
    tool_calls_log,
)

# Load environment variables from .env file
load_dotenv()

class AgentInputState(BaseModel):
    """Defines the expected input state for the AgenticChatFlow."""
    messages: List[Dict[str, str]] = []

@persist()
class AgenticChatFlow(CopilotKitFlow[AgentInputState]): # Inherit from CopilotKitFlow and use AgentInputState
    """
    The main chat flow that utilizes the CopilotKit state and integration.
    """

    @start()
    def chat(self):
        # pre_chat is called by CopilotKitFlow's kickoff/run logic if needed,
        # or you can ensure it's called if your override kickoff.
        # For now, assuming CopilotKitFlow handles its lifecycle methods.

        # Initialize system prompt
        system_prompt = "You are a helpful assistant."

        # Initialize CrewAI LLM with streaming enabled
        # CrewAI's LLM class expects 'model' as the parameter name
        llm = LLM(model="gpt-4o", stream=True)

        # Get message history using the base class method
        # This should now correctly use self.state.messages from AgentInputState
        messages = self.get_message_history(system_prompt=system_prompt)

        # Get available tools using the base class method
        # This should now correctly use self.state.tools from AgentInputState
        tools_definitions = self.get_available_tools()

        # Format tools for OpenAI API using the base class method
        formatted_tools, available_functions = self.format_tools_for_llm(tools_definitions)

        try:
            # Track tool calls
            initial_tool_calls_count = len(tool_calls_log)

            response_content = llm.call(
                messages=messages,
                tools=formatted_tools if formatted_tools else None,
                available_functions=available_functions if available_functions else None
            )

            # Handle tool responses using the base class method
            response = self.handle_tool_responses(
                llm=llm,
                response_text=response_content, # Pass the text content of the response
                messages=messages, # Original messages sent to LLM
                tools_called_count_before_llm_call=initial_tool_calls_count
            )

            return response

        except Exception as e:
            return f"\n\nAn error occurred: {str(e)}\n\n"


