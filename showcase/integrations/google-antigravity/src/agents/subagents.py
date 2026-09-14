"""Sub-agents as tools, as in langgraph-python's subagents.py.

Each tool runs one model call for its role and returns the prose. The
delegation log in the reference UI is fed by shared state, which this
adapter cannot write yet; the per-tool cards still render from the tool
calls (see PARITY_NOTES.md).

The three tools are ``async def`` on purpose. The adapter wraps every
server tool in an ``async def _invoke`` (``ui_bridge._build_server_tool``)
and awaits the result inline, and the SDK's tool runner only offloads
NON-coroutine callables to a worker thread — so a synchronous
``httpx.post`` body here runs on the event loop and blocks it for the
whole model call: every other in-flight SSE stream stalls, ``/health``
stops answering, and the entrypoint watchdog kills the agent after ~90s.
"""

# @region[subagent-setup]
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

# One connection pool for the whole process, created lazily on the first
# sub-agent call so importing this module never touches the network stack.
_HTTP_CLIENT: httpx.AsyncClient | None = None


def _http_client() -> httpx.AsyncClient:
    global _HTTP_CLIENT
    if _HTTP_CLIENT is None:
        _HTTP_CLIENT = httpx.AsyncClient(timeout=120.0)
    return _HTTP_CLIENT


async def close_http_client() -> None:
    """Closes the shared client. Called from agent_server's shutdown hook."""
    global _HTTP_CLIENT
    client, _HTTP_CLIENT = _HTTP_CLIENT, None
    if client is not None:
        await client.aclose()


async def _run(role: str, task: str) -> str:
    response = await _http_client().post(
        f"{base_url()}/v1/chat/completions",
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": _ROLE_PROMPTS[role]},
                {"role": "user", "content": task},
            ],
        },
        headers={"X-AIMock-Context": SLUG},
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"].get("content") or ""
    return content.strip() or SUB_AGENT_EMPTY_SENTINEL


# @region[supervisor-delegation-tools]
async def research_agent(task: str) -> str:
    """Delegate a research task; returns 3-5 key facts."""
    return await _run("research_agent", task)


async def writing_agent(task: str) -> str:
    """Delegate a drafting task; returns a one-paragraph draft."""
    return await _run("writing_agent", task)


async def critique_agent(task: str) -> str:
    """Delegate a review task; returns 2-3 critiques."""
    return await _run("critique_agent", task)


# @endregion[supervisor-delegation-tools]


def subagents_agent():
    from agents._common import build

    return build(
        system_instructions=SUPERVISOR_PROMPT,
        tools=[research_agent, writing_agent, critique_agent],
    )


# @endregion[subagent-setup]
