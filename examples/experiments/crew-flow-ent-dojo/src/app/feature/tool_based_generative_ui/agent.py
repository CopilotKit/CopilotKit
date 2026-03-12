#!/usr/bin/env python
from dotenv import load_dotenv
load_dotenv(override=True)
from typing import Optional
from crewai import LLM
from crewai.flow import start
from pydantic import BaseModel, Field
from copilotkit.crewai import (
    CopilotKitFlow,
    tool_calls_log,
    FlowInputState,
)
from crewai.flow import persist

GENERATE_HAIKU_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_haiku",
        "description": "Generate a haiku in Japanese and its English translation",
        "parameters": {
            "type": "object",
            "properties": {
                "japanese": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "An array of three lines of the haiku in Japanese"
                },
                "english": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "An array of three lines of the haiku in English"
                },
                "image_names": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "Names of 3 relevant images from the provided list"
                }
            },
            "required": ["japanese", "english", "image_names"]
        }
    }
}


class Haiku(BaseModel):
    """
    A haiku with Japanese and English versions, plus relevant images.
    """
    japanese: list[str] = Field(..., description="Three lines of the haiku in Japanese")
    english: list[str] = Field(..., description="Three lines of the haiku in English")
    image_names: list[str] = Field(..., description="Names of 3 relevant images")

class AgentState(FlowInputState):
    """
    The state of the haiku generation.
    """
    haiku: Optional[dict] = None

@persist()
class ToolBasedGenerativeUIFlow(CopilotKitFlow[AgentState]):

    @start()
    def chat(self):
        """
        Standard chat node for haiku generation.
        """
        system_prompt = "You assist the user in generating a haiku. When generating a haiku using the 'generate_haiku' tool, you MUST also select exactly 3 image filenames from the following list that are most relevant to the haiku's content or theme. Return the filenames in the 'image_names' parameter. Dont provide the relavent image names in your final response to the user. "

        # Initialize CrewAI LLM with streaming enabled
        llm = LLM(model="gpt-4o", stream=True)

        # Get message history using the base class method
        messages = self.get_message_history(system_prompt=system_prompt)


        # Ensure we have the user messages from the input state
        if hasattr(self.state, 'messages') and self.state.messages:
            for msg in self.state.messages:
                if msg.get('role') == 'user' and msg not in messages:
                    messages.append(msg)

        try:
            # Track tool calls
            initial_tool_calls_count = len(tool_calls_log)

            response_text = llm.call(
                messages=messages,
                tools=[GENERATE_HAIKU_TOOL],
                available_functions={"generate_haiku": self.generate_haiku_handler}
            )

            # Handle tool responses using the base class method
            response = self.handle_tool_responses(
                llm=llm,
                response_text=response_text,
                messages=messages,
                tools_called_count_before_llm_call=initial_tool_calls_count
            )


            return response

        except Exception as e:
            print(f"An error occurred: {str(e)}")
            return f"\n\nAn error occurred: {str(e)}\n\n"

    def generate_haiku_handler(self, japanese, english, image_names):
        """Handler for the generate_haiku tool"""
        # Convert the haiku data to a Haiku object for validation
        haiku_data = {
            "japanese": japanese,
            "english": english,
            "image_names": image_names
        }
        haiku_obj = Haiku(**haiku_data)
        # Store as dict for JSON serialization, but validate first
        self.state.haiku = haiku_obj.model_dump()

        return haiku_obj.model_dump_json(indent=2)
