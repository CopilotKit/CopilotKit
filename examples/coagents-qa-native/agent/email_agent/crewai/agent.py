"""Email Agent CrewAI Flow"""

import uuid
from typing import Any, Dict, cast
from crewai.flow.flow import Flow, start, router
from litellm import completion
from copilotkit.crewai import (
    copilotkit_customize_config,
    copilotkit_exit,
    copilotkit_emit_message,
    copilotkit_stream,
    copilotkit_predict_state
)
from email_agent.model import get_model
from email_agent.state import EmailAgentState

# Define a tool for composing emails – analogous to the "EmailTool" in LangGraph.
EMAIL_TOOL = {
    "type": "function",
    "function": {
        "name": "EmailTool",
        "description": "Compose an email based on instructions.",
        "parameters": {
            "type": "object",
            "properties": {
                "the_email": {
                    "type": "string",
                    "description": "The composed email."
                }
            },
            "required": ["the_email"]
        }
    }
}


class EmailAgentFlow(Flow[Dict[str, Any]]):
    """
    CrewAI Flow for composing and sending emails.
    """

    @start()
    async def create_email(self):
        """
        Compose an email.
        """
        # Ensure required fields exist in the state.
        # Instead of interrupting, we assign default placeholders if missing.
        sender = self.state.get("sender")
        if not sender:
            sender = "Default Sender"
            self.state["sender"] = sender

        sender_company = self.state.get("sender_company")
        if not sender_company:
            sender_company = "Default Company"
            self.state["sender_company"] = sender_company

        # Build the instructions prompt.
        prompt = (
            f"You write emails. The email is by the following sender: {sender}, "
            f"working for: {sender_company}"
        )

        response = await copilotkit_stream(
            completion(
                model="openai/gpt-4o",
                messages=[
                    {"role": "system", "content": prompt},
                    *self.state.get("messages", [])
                ],
                tools=[EMAIL_TOOL],
                tool_choice="EmailTool",
                stream=True
            )
        )

        # Extract the tool call from the response.
        message = cast(Any, response).choices[0]["message"]
        tool_calls = message.get("tool_calls", [])
        if tool_calls:
            email_text = tool_calls[0]["args"].get("the_email", "")
        else:
            email_text = ""

        # Update the state with the composed email and record the message.
        self.state["email"] = email_text
        self.state.setdefault("messages", []).append(message)

        return "send_email"

    @router(create_email)
    async def send_email(self):
        """
        Send the composed email.
        """
        await copilotkit_exit()

        last_message = self.state.get("messages", [])[-1]
        if last_message.get("content") == "CANCEL":
            text_message = "❌ Cancelled sending email."
        else:
            text_message = "✅ Sent email."

        await copilotkit_emit_message(text_message)
        self.state.setdefault("messages", []).append(
            {"role": "assistant", "content": text_message, "id": str(uuid.uuid4())}
        )
        return None
