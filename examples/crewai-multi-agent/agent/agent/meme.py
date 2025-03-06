"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import json
from litellm import completion
from crewai.flow.flow import Flow, start, router, listen
from copilotkit.crewai import copilotkit_stream, copilotkit_exit


MAKE_MEME_TOOL = {
    "type": "function",
    "function": {
        "name": "make_meme",
        "description": "Pick a meme template and generate the text for the meme",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string", 
                    "description": "The template id to use for the meme"
                },
                "text": {
                    "type": "array",
                    "description": "The lines of text to use for the meme. I.e. if the meme has a line count of 2, you need to provide 2 strings. If you want a line to be empty, provide an empty string.", # pylint: disable=line-too-long
                    "items": {
                        "type": "string"
                    }
                }
            },
            "required": ["id", "text"]
        }
    }
}

EXIT_AGENT_TOOL = {
    "type": "function",
    "function": {
        "name": "exit_agent",
        "description": "Exit the meme generation agent. Call this when the user is done generating memes." # pylint: disable=line-too-long
    }
}

tools = [
    MAKE_MEME_TOOL,
    EXIT_AGENT_TOOL
]

tool_handlers = {
    "make_meme": lambda args: "Meme created.",
    "exit_agent": lambda args: "Agent exited."
}

class MemeAgentFlow(Flow):
    """
    This is a flow that uses the CopilotKit framework to create a meme generation agent.
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
        system_prompt = """
        You are a meme generator. You will be given a meme template and a list of text lines.
        Make sure your meme is funny and relevant to what the user wants.
        """.strip()

        response = await copilotkit_stream(
            completion(

                # 1.1 Specify the model to use
                model="openai/gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": system_prompt
                    },
                    *self.state.messages
                ],

                # 1.2 Bind the tools to the model
                tools=tools,
                parallel_tool_calls=False,
                stream=True
            )
        )

        message = response.choices[0].message

        # 2. Append the message to the messages in state
        self.state.messages.append(message)

        # 3. Handle tool calls
        if message.get("tool_calls"):
            tool_call = message["tool_calls"][0]
            tool_call_id = tool_call["id"]
            tool_call_name = tool_call["function"]["name"]
            tool_call_args = json.loads(tool_call["function"]["arguments"])

            handler = tool_handlers[tool_call_name]
            result = handler(tool_call_args)

            self.state.messages.append({
                "role": "tool",
                "content": result,
                "tool_call_id": tool_call_id
            })

            if tool_call_name == "exit_agent":
                await copilotkit_exit()

            if tool_call_name == "make_meme":
                return "route_follow_up"
            else:
                return "route_end"

        # 4. If there are no tool calls, return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """
