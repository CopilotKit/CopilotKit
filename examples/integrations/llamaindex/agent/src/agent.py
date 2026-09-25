import os
from typing import Annotated

from llama_index.core.base.llms.types import MessageRole, TextBlock
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


class StarterOpenAI(OpenAI):
    async def astream_chat_with_tools(
        self,
        tools,
        user_msg=None,
        chat_history=None,
        verbose=False,
        allow_parallel_tool_calls=False,
        tool_required=False,
        **kwargs,
    ):
        # The AG-UI adapter converts tool results to user messages and renders
        # assistant tool calls as text. Restore both sides of the OpenAI tool
        # exchange without changing the workflow's saved conversation.
        request_history = [
            message.model_copy(deep=True) for message in chat_history or []
        ]
        for index, message in enumerate(request_history):
            calls = message.additional_kwargs.get("ag_ui_tool_calls")
            if calls and message.role == MessageRole.ASSISTANT:
                rendered = "\n".join(
                    f"<tool_call><name>{call['name']}</name><arguments>{call['arguments']}</arguments></tool_call>"
                    for call in calls
                )
                content = message.content or ""
                if content.endswith(rendered):
                    message.blocks = [
                        TextBlock(text=content[: -len(rendered)].removesuffix("\n\n"))
                    ]
                message.additional_kwargs = {
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": call["arguments"],
                            },
                        }
                        for call in calls
                    ]
                }

            if "tool_call_id" not in message.additional_kwargs:
                continue
            # The adapter adds state to the latest user-role message. Its
            # converted tool result is not a user prompt, so move the state
            # block to the preceding actual user message before re-roling it.
            content = message.content or ""
            if content.startswith("<state>\n") and "</state>\n\n" in content:
                state, result = content.split("</state>\n\n", 1)
                prior_user = next(
                    (
                        previous
                        for previous in reversed(request_history[:index])
                        if previous.role == MessageRole.USER
                        and "tool_call_id" not in previous.additional_kwargs
                    ),
                    None,
                )
                if prior_user is not None:
                    prior_user.blocks.insert(0, TextBlock(text=f"{state}</state>\n\n"))
                    message.blocks = [TextBlock(text=result.removesuffix("\n"))]
            message.role = MessageRole.TOOL
        return await super().astream_chat_with_tools(
            tools=tools,
            user_msg=user_msg,
            chat_history=request_history,
            verbose=verbose,
            allow_parallel_tool_calls=allow_parallel_tool_calls,
            tool_required=tool_required,
            **kwargs,
        )


# This tool has a client-side version that is actually called to change the background
# These tools just need a response string to make it look like they are executing
def change_theme_color(
    theme_color: Annotated[str, "The hex color value. i.e. '#123456''"],
) -> str:
    """Change the background color of the chat. Can be any hex color value."""
    return f"Changing background to {theme_color}"


# This is another client-side tool that is actually called to add a proverb to the list
# These tools just need a response string to make it look like they are executing
async def add_proverb(
    proverb: Annotated[str, "The proverb to add. Make it witty, short and concise."],
) -> str:
    """Add a proverb to the list of proverbs."""
    return f"Added proverb: {proverb}"


# This is a backend tool that executes code on the backend server
# For now this is a dummy implementation, but it could very well call a weather API
async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return f"The weather in {location} is sunny and 70 degrees."


# LlamaIndex's OpenAI LLM resolves its base URL from OPENAI_API_BASE only, so the
# conventional OPENAI_BASE_URL (used by the OpenAI SDKs and by our aimock-backed
# docker-compose.test.yml) is ignored and requests go to api.openai.com. Forward it
# explicitly as api_base.
_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

agentic_chat_router = get_ag_ui_workflow_router(
    llm=StarterOpenAI(model="gpt-5-mini", **_openai_kwargs),
    # Tools that are executed in the frontend client
    frontend_tools=[change_theme_color, add_proverb],
    # Tools that are executed in the backend server
    backend_tools=[get_weather],
    system_prompt="You are a helpful assistant that can add proverbs to a list, get the weather for a given location, and change the background color of the chat/app background.",
    initial_state={
        "proverbs": [
            "CopilotKit may be new, but its the best thing since sliced bread.",
        ],
    },
)
