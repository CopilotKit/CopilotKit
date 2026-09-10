"""Sub-agents as tools, as in langgraph-python's subagents.py.

Each tool runs one model call for its role and returns the prose. The
delegation log in the reference UI is fed by shared state, which this
adapter cannot write yet; the per-tool cards still render from the tool
calls (see PARITY_NOTES.md).
"""

import httpx

from agents._common import MODEL, SLUG, base_url

SUPERVISOR_PROMPT = (
    "You are a supervisor. For research tasks call `research_agent`, for "
    "drafting call `writing_agent`, for review call `critique_agent`. "
    "Delegate step by step: research first, then write, then critique once, "
    "then answer the user with the final draft."
)

_ROLE_PROMPTS = {
    "research_agent": "You are a research sub-agent. Given a topic, produce a concise bulleted list of 3-5 key facts. No preamble, no closing.",
    "writing_agent": "You are a writing sub-agent. Given a brief and optional source facts, produce a polished 1-paragraph draft. Be clear and concrete. No preamble.",
    "critique_agent": "You are an editorial critique sub-agent. Given a draft, give 2-3 crisp, actionable critiques. No preamble.",
}

SUB_AGENT_EMPTY_SENTINEL = "<sub-agent produced no output>"


def _run(role: str, task: str) -> str:
    response = httpx.post(
        f"{base_url()}/v1/chat/completions",
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": _ROLE_PROMPTS[role]},
                {"role": "user", "content": task},
            ],
        },
        headers={"X-AIMock-Context": SLUG},
        timeout=120.0,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"].get("content") or ""
    return content.strip() or SUB_AGENT_EMPTY_SENTINEL


def research_agent(task: str) -> str:
    """Delegate a research task; returns 3-5 key facts."""
    return _run("research_agent", task)


def writing_agent(task: str) -> str:
    """Delegate a drafting task; returns a one-paragraph draft."""
    return _run("writing_agent", task)


def critique_agent(task: str) -> str:
    """Delegate a review task; returns 2-3 critiques."""
    return _run("critique_agent", task)


def subagents_agent():
    from agents._common import build

    return build(
        system_instructions=SUPERVISOR_PROMPT,
        tools=[research_agent, writing_agent, critique_agent],
    )
