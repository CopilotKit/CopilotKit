"""Agno Proverbs Agent with weather tool for showcase demos."""

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

load_dotenv()


@tool
def get_weather(location: str):
    """
    Get the weather for a given location. Ensure location is fully spelled out.

    Args:
        location (str): The location to get the weather for.

    Returns:
        str: The weather for the given location.
    """
    return f"The weather in {location} is sunny."


@tool(external_execution=True)
def set_proverbs(new_proverbs: list[str]):
    """
    Set the list of proverbs using the provided new list.
    Always pass the COMPLETE list of proverbs.

    Args:
        new_proverbs (list[str]): The new list of proverbs to maintain.
    """


@tool(external_execution=True)
def change_background(background: str):
    """
    Change the background color of the chat.
    ONLY call this tool when the user explicitly asks to change the background.
    Never call it proactively or as part of another response.
    Can be anything that the CSS background attribute accepts. Prefer gradients.

    Args:
        background (str): The CSS background value. Prefer gradients.
    """


@tool(external_execution=True)
def generate_proverb(text: str, gradient: str):
    """
    Generate a proverb and display it as a card.
    Use this tool when asked to create or generate a proverb.

    Args:
        text (str): The proverb text.
        gradient (str): CSS Gradient color for the background.
    """


@tool(external_execution=True)
def generate_task_steps(steps: list[dict]):
    """
    Generates a list of steps for the user to perform.
    Each step should have a description and status.

    Args:
        steps (list[dict]): A list of step objects, each with 'description' (str)
                            and 'status' ('enabled' or 'disabled').
    """


agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[
        get_weather,
        set_proverbs,
        change_background,
        generate_proverb,
        generate_task_steps,
    ],
    description="You are a helpful assistant for the CopilotKit showcase demos.",
    instructions="""
        PROVERBS:
        When a user asks you to do anything regarding proverbs, use the set_proverbs tool.
        Always pass the COMPLETE LIST of proverbs to the set_proverbs tool.
        Be creative and helpful in generating complete, practical proverbs.
        After using the tool, provide a brief summary of what you created, removed, or changed.

        WEATHER:
        Only call the get_weather tool if the user asks about the weather.
        If the user does not specify a location, use "Everywhere ever in the whole wide world".

        BACKGROUND:
        Only call change_background when the user explicitly asks to change colors/background.

        PROVERB GENERATION (gen-ui):
        When asked to create or generate a proverb, use the generate_proverb tool.
        Always provide a creative proverb text and a beautiful CSS gradient.

        TASK STEPS (HITL):
        When asked to plan something, use the generate_task_steps tool with a list of steps.
        Each step should have a description and status of "enabled".
    """,
)
