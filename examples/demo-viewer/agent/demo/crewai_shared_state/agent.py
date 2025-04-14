"""
A demo of shared state between the agent and CopilotKit.
"""

import json
from enum import Enum
from typing import List, Optional
from litellm import completion
from pydantic import BaseModel
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

class SpecialPreferences(str, Enum):
    """
    Special preferences for the recipe.
    """
    HIGH_PROTEIN = "High Protein"
    LOW_CARB = "Low Carb"
    SPICY = "Spicy"
    BUDGET_FRIENDLY = "Budget-Friendly"
    ONE_POT_MEAL = "One-Pot Meal"
    VEGETARIAN = "Vegetarian"
    VEGAN = "Vegan"

class CookingTime(str, Enum):
    """
    The cooking time of the recipe.
    """
    FIVE_MIN = "5 min"
    FIFTEEN_MIN = "15 min"
    THIRTY_MIN = "30 min"
    FORTY_FIVE_MIN = "45 min"
    SIXTY_PLUS_MIN = "60+ min"


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
                    "type": "object",
                    "properties": {
                        "skill_level": {
                            "type": "string",
                            "enum": [level.value for level in SkillLevel],
                            "description": "The skill level required for the recipe"
                        },
                        "special_preferences": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": [preference.value for preference in SpecialPreferences]
                            },
                            "description": "A list of special preferences for the recipe"
                        },
                        "cooking_time": {
                            "type": "string",
                            "enum": [time.value for time in CookingTime],
                            "description": "The cooking time of the recipe"
                        },
                        "ingredients": {
                            "type": "string",
                            "description": "A list of ingredients in the recipe"
                        },
                        "instructions": {
                            "type": "string",
                            "description": "Instructions for the recipe"
                        }
                    },
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
    skill_level: SkillLevel
    special_preferences: List[SpecialPreferences]
    cooking_time: CookingTime
    ingredients: str
    instructions: str


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
        This is the current state of the recipe: {json.dumps(self.state.model_dump_json(), indent=2)}
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
                for key, value in tool_call_args["recipe"].items():
                    setattr(self.state.recipe, key, value)

                # 4.1 Append the result to the messages in state
                self.state.messages.append({
                    "role": "tool",
                    "content": "Recipe generated.",
                    "tool_call_id": tool_call_id
                })
                return "route_follow_up"

        # 5. If our tool was not called, return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """