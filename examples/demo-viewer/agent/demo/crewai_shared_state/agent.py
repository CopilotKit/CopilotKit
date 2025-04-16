"""
A demo of shared state between the agent and CopilotKit.
"""

import json
from enum import Enum
from typing import List, Optional
from litellm import completion
from pydantic import BaseModel, Field
from crewai.flow.flow import Flow, start, router, listen
from copilotkit.crewai import (
  copilotkit_stream, 
  copilotkit_predict_state,
  CopilotKitState
)

class SkillLevel(str, Enum):
    """
    The level of skill required for the recipe.
    """
    BEGINNER = "Beginner"
    INTERMEDIATE = "Intermediate"
    ADVANCED = "Advanced"

class CookingTime(str, Enum):
    """
    The cooking time of the recipe.
    """
    FIVE_MIN = "5 min"
    FIFTEEN_MIN = "15 min"
    THIRTY_MIN = "30 min"
    FORTY_FIVE_MIN = "45 min"
    SIXTY_PLUS_MIN = "60+ min"

class Ingredient(BaseModel):
    """
    An ingredient with its details.
    """
    icon: str = Field(..., description="Emoji icon representing the ingredient.")
    name: str = Field(..., description="Name of the ingredient.")
    amount: str = Field(..., description="Amount or quantity of the ingredient.")

GENERATE_RECIPE_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_recipe",
        "description": " ".join("""Generate or modify an existing recipe. 
        When creating a new recipe, specify all fields. 
        When modifying, only fill optional fields if they need changes; 
        otherwise, leave them empty.""".split()),
        "parameters": {
            "type": "object",
            "properties": {
                "recipe": {
                    "description": "The recipe object containing all details.",
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "The title of the recipe."
                        },
                        "skill_level": {
                            "type": "string",
                            "enum": [level.value for level in SkillLevel],
                            "description": "The skill level required for the recipe."
                        },
                        "dietary_preferences": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            },
                            "description": "A list of dietary preferences (e.g., Vegetarian, Gluten-free)."
                        },
                        "cooking_time": {
                            "type": "string",
                            "enum": [time.value for time in CookingTime],
                            "description": "The estimated cooking time for the recipe."
                        },
                        "ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "icon": {"type": "string", "description": "Emoji icon for the ingredient."},
                                    "name": {"type": "string", "description": "Name of the ingredient."},
                                    "amount": {"type": "string", "description": "Amount/quantity of the ingredient."}
                                },
                                "required": ["icon", "name", "amount"]
                            },
                            "description": "A list of ingredients required for the recipe."
                        },
                        "instructions": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Step-by-step instructions for preparing the recipe."
                        }
                    },
                    "required": ["title", "skill_level", "cooking_time", "dietary_preferences", "ingredients", "instructions"]
                }
            },
            "required": ["recipe"]
        }
    }
}

class Recipe(BaseModel):
    """
    A recipe.
    """
    title: str
    skill_level: SkillLevel
    dietary_preferences: List[str] = Field(default_factory=list)
    cooking_time: CookingTime
    ingredients: List[Ingredient] = Field(default_factory=list)
    instructions: List[str] = Field(default_factory=list)


class AgentState(CopilotKitState):
    """
    The state of the recipe.
    """
    recipe: Optional[Recipe] = None

class SharedStateFlow(Flow[AgentState]):
    """
    This is a sample flow that demonstrates shared state between the agent and CopilotKit.
    """

    @start()
    @listen("route_follow_up")
    async def start_flow(self):
        """
        This is the entry point for the flow.
        """

    @router(start_flow)
    async def chat(self):
        """
        Standard chat node.
        """
 
        system_prompt = f"""You are a helpful assistant for creating recipes. 
        This is the current state of the recipe: {self.state.model_dump_json(indent=2)}
        You can modify the recipe by calling the generate_recipe tool.
        If you have just created or modified the recipe, just answer in one sentence what you did.
        """

        # 1. Here we specify that we want to stream the tool call to generate_recipe
        #    to the frontend as state.
        await copilotkit_predict_state({
            "recipe": {
                "tool_name": "generate_recipe",
                "tool_argument": "recipe"
            }
        })

        # 2. Run the model and stream the response
        #    Note: In order to stream the response, wrap the completion call in
        #    copilotkit_stream and set stream=True.
        response = await copilotkit_stream(
            completion(

                # 2.1 Specify the model to use
                model="openai/gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": system_prompt
                    },
                    *self.state.messages
                ],

                # 2.2 Bind the tools to the model
                tools=[
                    *self.state.copilotkit.actions,
                    GENERATE_RECIPE_TOOL
                ],

                # 2.3 Disable parallel tool calls to avoid race conditions,
                #     enable this for faster performance if you want to manage
                #     the complexity of running tool calls in parallel.
                parallel_tool_calls=False,
                stream=True
            )
        )

        message = response.choices[0].message

        # 3. Append the message to the messages in state
        self.state.messages.append(message)

        # 4. Handle tool call
        if message.get("tool_calls"):
            tool_call = message["tool_calls"][0]
            tool_call_id = tool_call["id"]
            tool_call_name = tool_call["function"]["name"]
            tool_call_args = json.loads(tool_call["function"]["arguments"])

            if tool_call_name == "generate_recipe":
                # Attempt to update the recipe state using the data from the tool call
                try:
                    updated_recipe_data = tool_call_args["recipe"]
                    # Validate and update the state. Pydantic will raise an error if the structure is wrong.
                    self.state.recipe = Recipe(**updated_recipe_data)

                    # 4.1 Append the result to the messages in state
                    self.state.messages.append({
                        "role": "tool",
                        "content": "Recipe updated.", # More accurate message
                        "tool_call_id": tool_call_id
                    })
                    return "route_follow_up"
                except Exception as e:
                    # Handle validation or other errors during update
                    print(f"Error updating recipe state: {e}") # Log the error server-side
                    # Optionally inform the user via a tool message, though it might be noisy
                    # self.state.messages.append({"role": "tool", "content": f"Error processing recipe update: {e}", "tool_call_id": tool_call_id})
                    return "route_end" # End the flow on error for now

        # 5. If our tool was not called, return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """