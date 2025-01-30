"""
Flow agent
"""
from crewai.flow.flow import Flow, start
from litellm import completion
from copilotkit.crewai import copilotkit_emit_message


class ExampleFlow(Flow):

    @start()
    async def chat(self):
        """Just a simple chat with tools"""
        print("Starting flow", flush=True)
        response = completion(
            model="gpt-4o",
            messages=self.state["messages"],
            tools=self.state["copilotkit"]["actions"],
        )
        message = response["choices"][0]["message"]
        self.state["messages"].append(message)
