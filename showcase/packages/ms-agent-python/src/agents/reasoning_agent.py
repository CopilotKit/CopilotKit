"""
MS Agent Framework — reasoning demo agent.

Shared by two demos:
  - agentic-chat-reasoning      — custom rendered reasoning block
  - reasoning-default-render    — default rendering of reasoning content

Approach
--------
The LangGraph reference agent relies on AG-UI REASONING_MESSAGE_* events, which
CopilotKit renders natively via `CopilotChatReasoningMessage`. The MS Agent
Framework's current AG-UI bridge does not surface reasoning tokens as
first-class REASONING_MESSAGE events, so we fall back to the closest portable
pattern: a `think` tool.

Flow:
  1. The agent MUST call `think(thought=...)` before producing its final
     answer. Its `thought` field contains the step-by-step reasoning.
  2. The frontend renders the tool call with `useRenderTool("think", ...)` as
     a visible reasoning block (custom or default style, per demo).
  3. The agent then produces a concise final answer as a normal assistant
     message.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent
from pydantic import Field


@tool(
    name="think",
    description=(
        "Record a step-by-step reasoning trace that the UI will render as a "
        "visible thinking block. Always call this tool BEFORE answering the "
        "user's question. Use a single call per user turn."
    ),
)
def think(
    thought: Annotated[
        str,
        Field(
            description=(
                "A concise, step-by-step reasoning chain leading toward the "
                "final answer. Write in first person (e.g., 'First I'll..., "
                "then I'll...'). Keep it under ~5 short steps."
            )
        ),
    ],
) -> str:
    """Accept the reasoning; the UI displays it as a thinking block."""
    # The tool body is intentionally trivial: the useful payload is `thought`,
    # which the frontend receives via the tool-call args (rendered live).
    return "Reasoning recorded."


def create_reasoning_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Create the MS Agent Framework reasoning demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="reasoning_agent",
        instructions=dedent(
            """
            You are a helpful assistant that shows its work.

            Required workflow for EVERY user question:
              1. Call the `think` tool exactly once with a concise,
                 step-by-step reasoning chain describing how you will
                 approach the answer.
              2. After the tool call returns, produce a clear, concise
                 final assistant message with the actual answer.

            Rules:
              - You MUST call `think` before your final answer. Never skip it.
              - Keep the `thought` focused on reasoning, not the final answer.
              - Keep the final answer short (1-3 short paragraphs).
              - Do NOT repeat the reasoning in the final answer; just give
                the user the conclusion.
            """.strip()
        ),
        tools=[think],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkReasoningAgent",
        description=(
            "Demonstrates a visible reasoning chain via the `think` tool."
        ),
        require_confirmation=False,
    )
