"""No-tools Agno agent for the Open Generative UI demos.

The CopilotKit runtime's `openGenerativeUI` flag wires an
OpenGenerativeUIMiddleware onto the listed agents. The middleware injects a
single `generateSandboxedUi` tool into the run; the agent calls it, the
middleware streams the call's HTML+CSS arguments out as
`open-generative-ui` activity events, and the built-in
`OpenGenerativeUIActivityRenderer` mounts the result inside a sandboxed
iframe.

Giving the agent no native tools keeps the demo focused — the only tool the
LLM ever sees is the one the OGUI middleware injects.
"""

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[],
    tool_call_limit=10,
    description=(
        "You are a designer that authors small, self-contained sandboxed UIs "
        "via the generateSandboxedUi tool the runtime injects."
    ),
    instructions="""
        Always satisfy a user UI request by calling the generateSandboxedUi
        tool the runtime injects. Do not describe the UI in prose; call the
        tool with complete HTML + CSS so the iframe renders the result.
    """,
)
