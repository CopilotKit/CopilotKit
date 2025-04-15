"""
A demo of predictive state updates.
"""

import json
import uuid
from typing import Optional
from litellm import completion
from crewai.flow.flow import Flow, start, router, listen
from copilotkit.crewai import (
  copilotkit_stream, 
  copilotkit_predict_state,
  CopilotKitState
)

WRITE_DOCUMENT_TOOL = {
    "type": "function",
    "function": {
        "name": "write_document",
        "description": " ".join("""
            Write a document. Use markdown formatting to format the document.
            It's good to format the document extensively so it's easy to read.
            You can use all kinds of markdown.
            However, do not use italic or strike-through formatting, it's reserved for another purpose.
            You MUST write the full document, even when changing only a few words.
            When making edits to the document, try to make them minimal - do not change every word.
            Keep stories SHORT!
            """.split()),
        "parameters": {
            "type": "object",
            "properties": {
                "document": {
                    "type": "string",
                    "description": "The document to write"
                },
            },
        }
    }
}


class AgentState(CopilotKitState):
    """
    The state of the agent.
    """
    document: Optional[str] = None

class PredictiveStateUpdatesFlow(Flow[AgentState]):
    """
    This is a sample flow that demonstrates predictive state updates.
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
        system_prompt = f"""
        You are a helpful assistant for writing documents. 
        To write the document, you MUST use the write_document tool.
        You MUST write the full document, even when changing only a few words.
        When you wrote the document, DO NOT repeat it as a message. 
        Just briefly summarize the changes you made. 2 sentences max.
        This is the current state of the document: ----\n {self.state.document}\n-----
        """

        # 1. Here we specify that we want to stream the tool call to write_document
        #    to the frontend as state.
        await copilotkit_predict_state({
            "document": {
                "tool_name": "write_document",
                "tool_argument": "document"
            }
        })

        # 2. Run the model and stream the response
        #    Note: In order to stream the response, wrap the completion call in
        #    copilotkit_stream and set stream=True.
        response = await copilotkit_stream(
            completion(

                # 2.1 Specify the model to use
                model="openai/gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": system_prompt
                    },
                    *self.state.messages
                ],

                # 2.2 Bind the tools to the model
                tools=[
                    *self.state.copilotkit.actions,
                    WRITE_DOCUMENT_TOOL
                ],

                # 2.3 Disable parallel tool calls to avoid race conditions,
                #     enable this for faster performance if you want to manage
                #     the complexity of running tool calls in parallel.
                parallel_tool_calls=False,
                stream=True
            )
        )

        message = response.choices[0].message

        # 3. Append the message to the messages in state
        self.state.messages.append(message)

        # 4. Handle tool call
        if message.get("tool_calls"):
            tool_call = message["tool_calls"][0]
            tool_call_id = tool_call["id"]
            tool_call_name = tool_call["function"]["name"]
            tool_call_args = json.loads(tool_call["function"]["arguments"])

            if tool_call_name == "write_document":
                self.state.document = tool_call_args["document"]

                # 4.1 Append the result to the messages in state
                self.state.messages.append({
                    "role": "tool",
                    "content": "Document written.",
                    "tool_call_id": tool_call_id
                })

                # 4.2 Append a tool call to confirm changes
                self.state.messages.append({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": str(uuid.uuid4()),
                        "function": {
                            "name": "confirm_changes",
                            "arguments": "{}"
                        }
                    }]
                })

                return "route_end"

        # 5. If our tool was not called, return to the end route
        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """
