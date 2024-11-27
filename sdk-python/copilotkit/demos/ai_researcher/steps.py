"""
Main chatbot node.
"""


from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from copilotkit.langchain import copilotkit_customize_config

from copilotkit.demos.ai_researcher.state import AgentState

# pylint: disable=line-too-long

async def steps_node(state: AgentState, config: RunnableConfig):
    """
    The steps node is responsible for building the steps in the research process.
    """

    config = copilotkit_customize_config(
        config,
        emit_messages=True,
        emit_intermediate_state=[
            {
                "state_key": "steps",
                "tool": "search",
                "tool_argument": "steps"
            },
        ]
    )

    system_message = """
You are a search assistant. Your task is to help the user with complex search queries by breaking the down into smaller steps.

These steps are then executed serially. In the end, a final answer is produced in markdown format.
"""

    # use the openai tool format to get access to enums
    search_tool = {
        'name': 'search',
        'description': """
Break the user's query into smaller steps.

Use step type "search" to search the web for information.

Make sure to add all the steps needed to answer the user's query.
""",
        'parameters': {
            'type': 'object',
            'properties': {
                'steps': {
                    'description': """The steps to be executed.""",
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'id': {
                                'description': 'The id of the step. This is used to identify the step in the state. Just make sure it is unique.',
                                'type': 'string'
                            },
                            'description': {
                                'description': 'The description of the step, i.e. "search for information about the latest AI news"',
                                'type': 'string'
                            },
                            'status': {
                                'description': 'The status of the step. Always "pending".',
                                'type': 'string',
                                'enum': ['pending']
                            },
                            'type': {
                                'description': 'The type of step.',
                                'type': 'string',
                                'enum': ['search']
                            }
                        },
                        'required': ['id', 'description', 'status', 'type']
                    }
                }
            },
            'required': ['steps']
        }
    }

    response = await ChatOpenAI(model="gpt-4o").bind_tools([search_tool], parallel_tool_calls=False, tool_choice="search").ainvoke([
        *state["messages"],
        SystemMessage(
            content=system_message
        )
    ], config)

    steps = response.tool_calls[0]["args"]["steps"]

    if len(steps):
        steps[0]["updates"] = "Searching the web..."

    return {
        "messages": [
            response,
            ToolMessage(
                name=response.tool_calls[0]["name"],
                content="executing steps...",
                tool_call_id=response.tool_calls[0]["id"]
            )
        ],
        "steps": steps.copy(),
    }
