"""FastAPI server exposing banking's deep agent over AG-UI.

The reskinnable demo's Next app registers this endpoint as an ordinary AG-UI
agent (`HttpAgent`) in its server agent registry, so every event this service
emits — reasoning, tool calls, subagent activity, the final report tool — rides
the same AG-UI stream as any other agent in the app.
"""

import os

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import build_agent

load_dotenv()

app = FastAPI(
    title="Northwind offsite-expenses agent",
    description="LangChain deep agent behind the reskinnable demo's banking skin",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Health check — `run-demo.sh` and docker-compose both wait on this."""
    return {"status": "ok", "service": "banking-agent"}


class BankingAGUIAgent(LangGraphAGUIAgent):
    """`LangGraphAGUIAgent` with a working `clone()`.

    WORKAROUND for an incompatibility between two published packages, not a
    preference. `ag_ui_langgraph`'s endpoint clones the agent on EVERY request
    (`endpoint.py`, for per-request state isolation), and since upstream commit
    3dec0125 "feat(langgraph): add structured interrupt/resume support"
    (2026-06-12, released in ag-ui-langgraph 0.0.42) the base `clone()` passes
    three newer keyword arguments — `enable_legacy_on_interrupt_event`,
    `emit_interrupt_outcome`, `emit_raw_events`.

    `copilotkit`'s `LangGraphAGUIAgent.__init__` accepts only
    `(name, graph, description, config)` and does not override `clone()`, so on
    ag-ui-langgraph >= 0.0.42 every single request dies with:

        TypeError: LangGraphAGUIAgent must override clone() or ensure its
        __init__ accepts (name, graph, description, config) as keyword
        arguments: ... unexpected keyword argument
        'enable_legacy_on_interrupt_event'

    Verified against copilotkit 0.1.95 (the current release AND this repo's own
    `sdk-python` source) with ag-ui-langgraph 0.0.43.

    Dropping the three flags is safe HERE: this agent uses no structured
    interrupts and does not consume raw events, so the base defaults are what we
    want anyway. The real fix belongs in the SDK — either a `clone()` override
    or a `**kwargs` passthrough in
    `sdk-python/copilotkit/langgraph_agui_agent.py`. Delete this class once that
    ships.
    """

    def clone(self):
        clone = type(self)(
            name=self.name,
            graph=self.graph,
            description=self.description,
            config=dict(self.config) if self.config else None,
        )
        # Carry the flag across the per-request clone by hand.
        #
        # `emit_raw_events` defaults to True, which piggybacks LangChain's
        # internal event objects onto the AG-UI stream. On a multi-minute run
        # that is most of the payload — a measured run streamed ~27MB, of which
        # RAW was the single largest event category. The thread PERSISTS those
        # events (a completed run replayed 8221 of them), and this demo's whole
        # premise is that you can leave a running thread and come back to it, so
        # the replay path pays that weight every time.
        #
        # Nothing downstream reads RAW: the report card renders off
        # TOOL_CALL_RESULT and the transcript off TEXT_MESSAGE_*.
        #
        # It is set as an ATTRIBUTE rather than a constructor argument because
        # `copilotkit`'s `LangGraphAGUIAgent.__init__` accepts only
        # (name, graph, description, config) — the same narrow signature behind
        # the clone() bug this class already works around.
        clone.emit_raw_events = self.emit_raw_events
        return clone

    async def run(self, input):
        """Log what the host sent, once per run.

        NOT once per process. A run against the Intelligence runtime arrives as
        TWO calls into this service: thread-name generation first (two messages,
        zero tools — correctly, it is only naming the conversation), then the
        user's actual run carrying the browser's frontend tools plus the
        Intelligence MCP tools (`recall_memory`, `save_memory`, `forget_memory`,
        `copilotkit_knowledge_base_shell`).

        Instrumenting only the first call is how you conclude the platform
        forwards nothing when it forwards everything. It cost a full round of
        wrong analysis here; the fix is one line, and it is this one.
        """
        names = [
            getattr(t, "name", None) for t in (getattr(input, "tools", None) or [])
        ]
        print(
            f"[banking-agent] run: {len(input.messages or [])} message(s), "
            f"host sent {len(names)} tool(s) {sorted(n for n in names if n)}",
            flush=True,
        )
        async for event in super().run(input):
            yield event


banking_agent = BankingAGUIAgent(
    name="banking",
    description=(
        "Northwind Finance's banking copilot. Drives the dashboard, renders "
        "reports on the canvas, and runs the multi-minute offsite-expense "
        "analysis in a sandboxed shell with parallel research subagents."
    ),
    graph=build_agent(),
    # A multi-minute run over fourteen rows with per-merchant subagents and a
    # shell burns supersteps fast — a measured run used well over a hundred.
    # LangGraph's default is 25, and this is the ONLY place the adapter honours
    # the setting (see the note in `agent.py`).
    config={"recursion_limit": 300},
)

# See `clone()` above for why this is an attribute and why it matters.
banking_agent.emit_raw_events = False

add_langgraph_fastapi_endpoint(app=app, agent=banking_agent, path="/")


def main():
    import uvicorn

    host = os.getenv("SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("SERVER_PORT", "8124"))
    print(f"[banking-agent] listening on {host}:{port}")
    uvicorn.run("main:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
