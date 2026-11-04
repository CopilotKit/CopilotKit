"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import json

from ag_ui_crewai.sdk import CopilotKitState, copilotkit_stream
from crewai.flow.flow import Flow, listen, router, start
from litellm import acompletion

from src.model import completion_options, resolve_model


class AgentState(CopilotKitState):
    """
    Here we define the state of the agent

    In this instance, we're inheriting from CopilotKitState, which will bring in
    the CopilotKitState fields. We're also adding a custom field, `language`,
    which will be used to set the language of the agent.
    """

    proverbs: list[str] = []
    # What the page shares (useAgentContext). ag-ui-crewai writes the run's
    # AG-UI context here but never adds it to the prompt; see page_context().
    context: list[dict] = []
    # your_custom_agent_state: str = ""


GET_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state, e.g. San Francisco, CA",
                }
            },
            "required": ["location"],
        },
    },
}

tools = [
    GET_WEATHER_TOOL
    # your_tool_here
]

tool_handlers = {
    "get_weather": lambda args: (
        f"The weather for {args['location']} is 70 degrees, clear skies, 45% humidity, 5 mph wind, and feels like 72 degrees."
    )
    # your tool handler here
}


def page_context(context: list[dict]) -> str:
    """Render what the page shares (`useAgentContext`) for the system prompt.

    ag-ui-crewai copies a run's AG-UI `context` into the flow state's
    `context` field and does not add it to the prompt itself, so without this
    the model never sees it. Empty context renders as an empty string.
    """
    if not context:
        return ""
    shared = "\n\n".join(
        f"{entry['description']}:\n{entry['value']}" for entry in context
    )
    return f"\n\nContext provided by the application:\n\n{shared}"


class SampleAgentFlow(Flow[AgentState]):
    """
    This is a sample flow that uses the CopilotKit framework to create a chat agent.
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
        Standard chat node based on the ReAct design pattern. It handles:
        - The model to use (and binds in CopilotKit actions and the tools defined above)
        - The system prompt
        - Getting a response from the model
        - Handling tool calls

        For more about the ReAct design pattern, see:
        https://www.perplexity.ai/search/react-agents-NcXLQhreS0WDzpVaS4m9Cg
        """
        system_prompt = (
            f"You are a helpful assistant. The current proverbs are {self.state.proverbs}."
            + page_context(self.state.context)
        )

        # 1. Run the model and stream the response
        #    Note: In order to stream the response, wrap the completion call in
        #    copilotkit_stream and set stream=True.
        # 1.1 Specify the model to use. COPILOTKIT_AGENT_MODEL (e.g.
        #     "anthropic:claude-sonnet-4-5") overrides it; unset, the agent
        #     uses gpt-5-mini.
        model = resolve_model("openai:gpt-5-mini")
        response = await copilotkit_stream(
            await acompletion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    *self.state.messages,
                ],
                # 1.2 Bind the tools to the model
                tools=[*self.state.copilotkit.actions, GET_WEATHER_TOOL],
                # 1.3 Disable parallel tool calls to avoid race conditions,
                #     enable this for faster performance if you want to manage
                #     the complexity of running tool calls in parallel. Gemini
                #     refuses this option with several tools, so it keeps its
                #     default.
                **completion_options(model),
                stream=True,
            )
        )

        message = response.choices[0].message

        # Gemini keeps parallel tool calls on (see 1.3), so a reply can hold
        # several tool calls. Every call in the history needs a result before
        # the next model call.
        tool_calls = message.get("tool_calls") or []
        action_names = {
            action["function"]["name"] for action in self.state.copilotkit.actions
        }
        frontend_calls = [
            call for call in tool_calls if call["function"]["name"] in action_names
        ]

        # 2. If any tool call is a CopilotKit action, keep only the actions and
        #    return the response to CopilotKit. The frontend runs them and sends
        #    their results back. The model asks again for a dropped backend call.
        if frontend_calls:
            message["tool_calls"] = frontend_calls
            self.state.messages.append(message)
            return "route_end"

        # 3. Append the message to the messages in state
        self.state.messages.append(message)

        # 4. Otherwise, handle each tool call on the backend, and append its
        #    result to the messages in state
        for tool_call in tool_calls:
            handler = tool_handlers[tool_call["function"]["name"]]
            result = handler(json.loads(tool_call["function"]["arguments"]))
            self.state.messages.append(
                {"role": "tool", "content": result, "tool_call_id": tool_call["id"]}
            )

        # 5. Return to the follow up route to continue the conversation
        if tool_calls:
            return "route_follow_up"

        # 6. If there are no tool calls, return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """
