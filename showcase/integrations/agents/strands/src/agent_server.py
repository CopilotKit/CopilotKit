"""Multi-agent FastAPI server for the Strands showcase.

Each demo is registered in AGENT_FACTORIES and mounted at /<demo-id>/.
The unified Next.js frontend's HttpAgent talks to backendUrl + /<demo-id>/.

NOTE: The OTel ThreadingInstrumentor patch (see git history of the legacy
file) must run BEFORE any strands import. We preserve that ordering.
"""

import os
import sys

from opentelemetry.instrumentation.threading import (  # noqa: E402
    ThreadingInstrumentor as _ThreadingInstrumentor,
)


def _assert_strands_not_preimported() -> None:
    if "strands" in sys.modules:
        raise RuntimeError("strands imported before OTel patch applied")


_assert_strands_not_preimported()


def _disabled_instrument(self, *args, **kwargs):
    return self


_ThreadingInstrumentor.instrument = _disabled_instrument  # type: ignore[method-assign]


def _assert_instrumentor_patched() -> None:
    if _ThreadingInstrumentor.instrument is not _disabled_instrument:
        raise RuntimeError("ThreadingInstrumentor patch not applied")


_assert_instrumentor_patched()

import uvicorn  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

from agents._multi_agent_app import create_multi_agent_strands_app  # noqa: E402
from agents.agentic_chat import build_agentic_chat_agent  # noqa: E402

load_dotenv()

# AGENT_FACTORIES is the single source of truth. Manifest demos[].id list
# MUST mirror these keys (CI lint enforces). Phase 1 wires only
# agentic-chat; remaining demos added in Task 22 sweep.
AGENT_FACTORIES = {
    "a2ui-fixed-schema": build_agentic_chat_agent,
    "agentic-chat": build_agentic_chat_agent,
    "agentic-chat-reasoning": build_agentic_chat_agent,
    "chat-customization-css": build_agentic_chat_agent,
    "chat-slots": build_agentic_chat_agent,
    "declarative-gen-ui": build_agentic_chat_agent,
    "frontend-tools": build_agentic_chat_agent,
    "frontend-tools-async": build_agentic_chat_agent,
    "gen-ui-agent": build_agentic_chat_agent,
    "gen-ui-tool-based": build_agentic_chat_agent,
    "headless-complete": build_agentic_chat_agent,
    "headless-simple": build_agentic_chat_agent,
    "hitl": build_agentic_chat_agent,
    "hitl-in-app": build_agentic_chat_agent,
    "hitl-in-chat": build_agentic_chat_agent,
    "hitl-in-chat-booking": build_agentic_chat_agent,
    "prebuilt-popup": build_agentic_chat_agent,
    "prebuilt-sidebar": build_agentic_chat_agent,
    "reasoning-default-render": build_agentic_chat_agent,
    "tool-rendering": build_agentic_chat_agent,
    "tool-rendering-custom-catchall": build_agentic_chat_agent,
    "tool-rendering-default-catchall": build_agentic_chat_agent,
    "tool-rendering-reasoning-chain": build_agentic_chat_agent,
    "readonly-state-agent-context": build_agentic_chat_agent,
    "shared-state-read-write": build_agentic_chat_agent,
    "shared-state-streaming": build_agentic_chat_agent,
    "subagents": build_agentic_chat_agent,
}

app = create_multi_agent_strands_app(AGENT_FACTORIES)


def main():
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
