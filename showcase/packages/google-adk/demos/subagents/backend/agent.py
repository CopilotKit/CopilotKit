"""Google ADK agent backing the Sub-Agents demo.

Google ADK has first-class support for multi-agent hierarchies via
`sub_agents`. This reference cell wires up a root agent with two specialized
sub-agents so the root can delegate tasks.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


researcher = LlmAgent(
    name="Researcher",
    model="gemini-2.5-flash",
    description=(
        "Answers factual/research questions and gathers information. Prefers "
        "concise, sourced answers."
    ),
    instruction=(
        "You are a research assistant. Give concise, factual answers based on "
        "your training knowledge."
    ),
    tools=[],
)


writer = LlmAgent(
    name="Writer",
    model="gemini-2.5-flash",
    description=(
        "Drafts and polishes prose: summaries, emails, marketing copy, "
        "reports, stories."
    ),
    instruction=(
        "You are a writing assistant. Produce clear, well-structured prose in "
        "the requested voice and format."
    ),
    tools=[],
)


subagents_agent = LlmAgent(
    name="SubagentsRoot",
    model="gemini-2.5-flash",
    instruction=(
        "You coordinate two specialists: Researcher (facts/lookup) and Writer "
        "(prose). Route each user request to the appropriate sub-agent by "
        "transferring control. Summarize the final answer for the user."
    ),
    sub_agents=[researcher, writer],
    tools=[],
)
