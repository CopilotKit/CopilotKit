"""
Main chatbot node.
"""

import json

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import ToolMessage, AIMessage

from copilotkit.demos.autotale_ai.state import AgentState
from copilotkit.demos.autotale_ai.story.outline import set_outline
from copilotkit.demos.autotale_ai.story.characters import set_characters
from copilotkit.demos.autotale_ai.story.story import set_story
from copilotkit.demos.autotale_ai.story.style import set_style
from copilotkit.langchain import copilotkit_customize_config
# pylint: disable=line-too-long

async def chatbot_node(state: AgentState, config: RunnableConfig):
    """
    The chatbot is responsible for answering the user's questions and selecting
    the next route.
    """


    config = copilotkit_customize_config(
        config,
        emit_messages=True,
        emit_intermediate_state= [
            {
                "state_key": "outline",
                "tool": "set_outline",
                "tool_argument": "outline"
            },
            {
                "state_key": "characters",
                "tool": "set_characters",
                "tool_argument": "characters"
            },
            {
                "state_key": "story",
                "tool": "set_story",
                "tool_argument": "story"
            }
        ]
    )

    tools = [set_outline, set_style]

    if state.get("outline") is not None:
        tools.append(set_characters)

    if state.get("characters") is not None:
        tools.append(set_story)

    system_message = """
You help the user write a children's story. Please assist the user by either having a conversation or by 
taking the appropriate actions to advance the story writing process. Do not repeat the whole story again.

Your state consists of the following concepts:

- Outline: The outline of the story. Should be short, 2-3 sentences.
- Characters: The characters that make up the story (depends on outline)
- Story: The final story result. (depends on outline & characters)

If the user asks you to make changes to any of these,
you MUST take into account dependencies and make the changes accordingly.

Example: If after coming up with the characters, the user requires changes in the outline, you must first 
regenerate the outline.

Dont bother the user too often, just call the tools.
Especially, dont' repeat the story and so on, just call the tools.
"""
    if state.get("outline") is not None:
        system_message += f"\n\nThe current outline is: {state['outline']}"

    if state.get("characters") is not None:
        system_message += f"\n\nThe current characters are: {json.dumps(state['characters'])}"

    if state.get("story") is not None:
        system_message += f"\n\nThe current story is: {json.dumps(state['story'])}"

    last_message = state["messages"][-1] if state["messages"] else None

    if last_message and isinstance(last_message, AIMessage):
        system_message += """
The user did not submit the last message. This means they probably changed the state of the story by
in the UI. Figure out if you need to regenerate the outline, characters or story and call the appropriate
tool. If not, just respond to the user.
        """


    response = await ChatOpenAI(model="gpt-4o").bind_tools(tools, parallel_tool_calls=False).ainvoke([
        *state["messages"],
        SystemMessage(
            content=system_message
        )
    ], config)

    tool_calls = getattr(response, "tool_calls", None)

    if not tool_calls:
        return {
            "messages": response,
        }

    return {
        "messages": [
            response,
            ToolMessage(
                name=tool_calls[0]["name"],
                content=json.dumps(tool_calls[0]["args"]),
                tool_call_id=tool_calls[0]["id"]
            )
        ],
    }
