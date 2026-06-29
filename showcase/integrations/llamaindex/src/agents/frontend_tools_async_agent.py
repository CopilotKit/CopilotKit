"""LlamaIndex agent backing the Frontend Tools (Async) demo.

Mirrors ``langgraph-python/src/agents/frontend_tools_async.py``. The page
registers an ASYNC ``query_notes`` frontend tool via ``useFrontendTool`` (see
app/demos/frontend-tools-async/page.tsx); its handler awaits a simulated
client-side notes DB and returns matching notes, which the agent then
summarizes.

The backend declares NO tools of its own — ``query_notes`` is injected by
CopilotKit at request time and executes in the browser. The shared catch-all
``agent.py`` uses ``FixedAGUIChatWorkflow``, which does NOT forward
``RunAgentInput.tools``, so routing this cell there silently dropped the
``query_notes`` tool call and the NotesCard never mounted. This dedicated
router uses ``make_request_aware_router`` (the same request-tool-forwarding
path that backs beautiful-chat) so the page-injected ``query_notes`` reaches
the LLM and its call streams back to the client — exactly like LGP's native
``RunAgentInput.tools`` forwarding.
"""

import os

from llama_index.llms.openai import OpenAI

from agents._request_tools import make_request_aware_router


SYSTEM_PROMPT = (
    "You are a helpful assistant that can search the user's personal notes. "
    "When the user asks about their notes, call the `query_notes` tool with "
    "a concise keyword extracted from their request. The tool is provided "
    "by the frontend at runtime and runs entirely in the user's browser — "
    "you do not need to implement it yourself. After the tool returns, "
    "summarize the matching notes clearly and concisely. If no notes match, "
    "say so plainly and offer to try a different keyword."
)


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

# query_notes is injected at request time via useFrontendTool — forwarded to
# the LLM by the request-aware router (frontend_tools=[]). See _request_tools.py.
frontend_tools_async_router = make_request_aware_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
