"""
Flow agent
"""
from crewai.flow.flow import Flow, start
from litellm import completion


class ExampleFlow(Flow):

    @start()
    def chat(self):
        print("Starting flow")
        # Each flow state automatically gets a unique ID
        print(f"Flow State ID: {self.state['id']}")

        response = completion(
            model="gpt-4o",
            messages=self.state["messages"],
        )
        message = response["choices"][0]["message"]
        print(f"Message: {message}")
        self.state["messages"].append(message)

