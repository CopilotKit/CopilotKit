"""
Flow agent
"""
from crewai.flow.flow import Flow, start
from litellm import completion


class ExampleFlow(Flow):
    """Example flow"""
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
