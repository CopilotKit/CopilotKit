"""Thread-isolated subagent tools for the Finance ERP orchestrator.

Each tool runs an internal Deep Agent inside a ThreadPoolExecutor, which
breaks LangChain callback propagation at the OS thread boundary. This
prevents subagent events from leaking to the parent's astream_events()
stream (and ultimately the frontend chat).

Pattern adapted from deep-agents/agent/tools.py.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from prompts import RESEARCH_AGENT_PROMPT, PROJECTIONS_AGENT_PROMPT
from tools import research_tools, projections_tools


def _run_subagent(query: str, system_prompt: str, agent_tools: list) -> str:
    """Create and invoke a deep agent in the current (isolated) thread."""
    from deepagents import create_deep_agent
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        model=os.environ.get("OPENAI_MODEL", "gpt-5.4-2026-03-05"),
        temperature=0,
        streaming=True,
        api_key=os.environ.get("OPENAI_API_KEY"),
    )

    agent = create_deep_agent(
        model=llm,
        system_prompt=system_prompt,
        tools=agent_tools,
        # No middleware — this runs in an isolated thread
    )

    result = agent.invoke({"messages": [HumanMessage(content=query)]})
    return result["messages"][-1].content


@tool
def do_research(query: str) -> str:
    """Research the ERP database — invoices, accounts, transactions, inventory,
    employees, financial reports, cash flow analysis, and revenue forecasts.

    Use this tool for any question about current or historical company data.

    Args:
        query: The research question or data request.
    """
    print(f"[TOOL] do_research: query='{query}' (thread-isolated)")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _run_subagent, query, RESEARCH_AGENT_PROMPT, research_tools
        )
        result = future.result()

    print(f"[TOOL] do_research: completed ({len(result)} chars)")
    return result


@tool
def do_projections(query: str) -> str:
    """Compute financial projections — revenue forecasts, cash flow projections,
    scenario analysis, and trend analysis from historical data.

    Use this tool for forward-looking questions about future quarters,
    "what-if" scenarios, or trend analysis.

    Args:
        query: The projection or forecast request.
    """
    print(f"[TOOL] do_projections: query='{query}' (thread-isolated)")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _run_subagent, query, PROJECTIONS_AGENT_PROMPT, projections_tools
        )
        result = future.result()

    print(f"[TOOL] do_projections: completed ({len(result)} chars)")
    return result
