"""Thin Agno agent for the Open Generative UI demos.

LGP leaves `generateSandboxedUi` as a frontend tool and lets middleware
turn the call into iframe activity events. Agno drops unknown tool names
(`Function … not found`), so this agent declares the same name.

It is a real (not external) tool that returns at once. An external call
waits for a frontend result the OGUI middleware never sends, so the
agent starts another run (done-signal-missing, runsFinished=9).
"""

import json

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

load_dotenv()


@tool
def generateSandboxedUi(
    html: str = "",
    css: str = "",
    initialHeight: int = 400,
    placeholderMessages: list = None,
    jsFunctions: str = "",
    jsExpressions: str = "",
):
    """Author a sandboxed HTML + CSS UI for the iframe renderer.

    Args:
        html (str): HTML body.
        css (str): CSS.
        initialHeight (int): Iframe height.
        placeholderMessages (list): Short build messages.
        jsFunctions (str): Script to run in the iframe.
        jsExpressions (str): Extra expressions.
    """
    return json.dumps({"ok": True})


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[generateSandboxedUi],
    tool_call_limit=4,
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
