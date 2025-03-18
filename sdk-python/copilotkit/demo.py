"""
This is a demo of the LlamaIndexAgent.
"""
import asyncio
from llama_index.llms.openai import OpenAI
from llama_index.core.workflow import (
    StartEvent,
    StopEvent,
    Workflow,
    step,
    Event,
    Context,
)
from copilotkit.llamaindex.llamaindex_agent import LlamaIndexAgent
from llama_index.core.base.llms.types import ChatMessage
from typing import Any, cast
from llama_index.core.tools import FunctionTool
import pprint

# Define a simple calculator tool
def multiply(a: float, b: float) -> float:
    """Useful for multiplying two numbers."""
    return a * b

class FirstEvent(Event):
    first_output: str


class SecondEvent(Event):
    second_output: str
    response: str


class ProgressEvent(Event):
    msg: str

class MyWorkflow(Workflow):
    @step
    async def step_one(self, ctx: Context, ev: StartEvent) -> FirstEvent:
        ctx.write_event_to_stream(ProgressEvent(msg="Step one is happening"))
        return FirstEvent(first_output="First step complete.")

    @step
    async def step_two(self, ctx: Context, ev: FirstEvent) -> SecondEvent:
        # agent = FunctionAgent(
        #     name="Agent",
        #     description="Useful for multiplying two numbers",
        #     tools=[multiply],
        #     llm=OpenAI(model="gpt-4o-mini"),
        #     system_prompt="You are a helpful assistant that can multiply two numbers.",
        # )

        llm = OpenAI(model="gpt-4o-mini")
        response = await llm.acomplete(  # type: ignore
            "Please say hello in 2 sentences."
        )
        # response = await llm.astream_chat_with_tools(  # type: ignore
        #     tools=[FunctionTool.from_defaults(fn=multiply)],
        #     chat_history=[ChatMessage(content="Say hello to the world")],
        #     allow_parallel_tool_calls=False
        # )

        print(type(response))
        pprint.pprint(response.__dict__, indent=4)

        # async for chunk in response:
        #     print("RESPONSE:", type(chunk), flush=True)
        #     pprint.pprint(chunk.__dict__, indent=4)
            # print("text:", response.text, flush=True)
            # print("raw:", response.raw, flush=True)
            # print("delta:", response.delta, flush=True)
            # print("logprobs:", response.logprobs, flush=True)
        # print("additional_kwargs:", response.additional_kwargs, flush=True)

        #         text: str
        # additional_kwargs: dict = Field(default_factory=dict)
        # raw: Optional[Any] = None
        # logprobs: Optional[List[List[LogProb]]] = None
        # delta: Optional[str] = None
        # generator = await llm.astream_complete(
        #     "Please say hello in 2 sentences."
        # )
        # async for response in generator:
        #     # Assuming response is a dictionary or can be converted to one
        #     print("RESPONSE:", type(response), response.delta, flush=True)
        return SecondEvent(
            second_output="Second step complete, full response attached",
            response="Hello, world!",
        )

    @step
    async def step_three(self, ctx: Context, ev: SecondEvent) -> StopEvent:
        ctx.write_event_to_stream(ProgressEvent(msg="Step three is happening"))
        return StopEvent(result="Workflow complete.")




async def async_main():
    """
    This is a demo of the LlamaIndexAgent.
    """
    workflow = MyWorkflow(timeout=30)

    agent = LlamaIndexAgent(
        name="Agent",
        workflow=workflow,
    )

    await agent.execute(
        state={},
        thread_id="1",
        messages=[],
    )

    print("Hello, world!")

def main():
    print("here")
    # sleep for 1 second
    asyncio.run(async_main())

  
if __name__ == "__main__":
    main()
