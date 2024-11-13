"""
Story node.
"""

from typing import List
import json
import asyncio

from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.pydantic_v1 import BaseModel, Field
from langchain_openai import ChatOpenAI

from copilotkit.demos.autotale_ai.state import AgentState, Character


class ImageDescription(BaseModel):
    """
    Represents the description of an image of a character in the story.
    """
    description: str

async def _generate_page_image_description(
        messages: list,
        page_content: str,
        characters: List[Character],
        style: str,
        config: RunnableConfig
    ):
    """
    Generate a description of the image of a character.
    """

    system_message = SystemMessage(
        content= f"""
The user and the AI are having a conversation about writing a children's story.
It's your job to generate a vivid description of a page in the story.
Make the description as detailed as possible.

These are the characters in the story:
{characters}

This is the page content:
{page_content}

This is the graphical style of the story:
{style}

Imagine an image of the page. Describe the looks of the page in great detail.
Also describe the setting in which the image is taken.
Make sure to include the name of the characters and full description of the characters in your output.
Describe the style in detail, it's very important for image generation.
        """
    )
    model = ChatOpenAI(model="gpt-4o").with_structured_output(ImageDescription)
    response = await model.ainvoke([
        *messages,
        system_message
    ], config)

    return response.description

class StoryPage(BaseModel):
    """
    Represents a page in the children's story. Keep it simple, 3-4 sentences per page.
    """
    content: str = Field(..., description="A single page in the story")

@tool
def set_story(pages: List[StoryPage]):
    """
    Considering the outline and characters, write a story.
    Keep it simple, 3-4 sentences per page.
    5 pages max.
    (If the user mentions "chapters" in the conversation they mean pages, treat it as such)
    """
    return pages

async def story_node(state: AgentState, config: RunnableConfig):
    """
    The story node is responsible for extracting the story from the conversation.
    """
    last_message = state["messages"][-1]
    pages = json.loads(last_message.content)["pages"]
    characters = state.get("characters", [])
    style = state.get("style", "Pixar movies style 3D images")

    async def generate_page(page):
        description = await _generate_page_image_description(
            state["messages"],
            page["content"],
            characters,
            style,
            config
        )
        return {
            "content": page["content"],
            "image_description": description
        }

    tasks = [generate_page(page) for page in pages]
    story = await asyncio.gather(*tasks)

    return {
        "story": story
    }
