"""shared-state-streaming — MAF agent that streams `document` per token.

Mirrors LangGraph's `langgraph-python/src/agents/shared_state_streaming.py`.
The frontend (`src/app/demos/shared-state-streaming/page.tsx`) subscribes
to `agent.state.document` via `useAgent` and re-renders the document
view as content arrives. This agent's job is to call `write_document`
with a full document string; the `predict_state_config` here mirrors
LGP's `StateStreamingMiddleware(StateItem(state_key="document",
tool="write_document", tool_argument="document"))` — it tells the
runtime to forward every token of the tool's `document` argument
directly into `state.document` while the tool call is still streaming.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from textwrap import dedent
from typing import Annotated, Any

from ag_ui.core import BaseEvent, EventType, StateSnapshotEvent
from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent, state_update
from pydantic import Field


STATE_SCHEMA: dict[str, object] = {
    "document": {
        "type": "string",
        "description": "The full document body, streamed token-by-token.",
    }
}

# Tells the runtime to stream tool-argument deltas straight into
# `state.document` while `write_document` is still streaming — matches
# LGP's StateStreamingMiddleware setup.
PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "document": {
        "tool": "write_document",
        "tool_argument": "document",
    }
}


@tool(
    name="write_document",
    description=(
        "Write a document for the user. Always call this tool when the "
        "user asks you to write, draft, or revise any text. The "
        "`document` argument is streamed per-token into shared state "
        "under the `document` key so the UI renders the body live."
    ),
)
def write_document(
    document: Annotated[
        str,
        Field(description="The full document content as a single string."),
    ],
):
    """Commit the final document body to shared state.

    Per-token streaming of the `document` arg is handled by the runtime
    via `predict_state_config`; this final `state_update` is the
    authoritative commit after the tool finishes streaming.
    """
    return state_update(
        text="Document written to shared state.",
        state={"document": document},
    )


SYSTEM_PROMPT = dedent(
    """
    You are a collaborative writing assistant. Whenever the user asks
    you to write, draft, or revise any piece of text, ALWAYS call the
    `write_document` tool with the full content as a single string in
    the `document` argument. Never paste the document into a chat
    message directly — the document belongs in shared state and the UI
    renders it live as you type.
    """
).strip()


class SharedStateStreamingFrameworkAgent(AgentFrameworkAgent):
    """Seeds ``state.document`` before the run so predictive STATE_DELTAs apply.

    MAF's initial AG-UI agent state is ``{}`` — ``state_schema`` contributes
    property *definitions* but no seeded *values*, and the deterministic
    StateSnapshotEvent is only emitted AFTER a tool result. The predictive
    STATE_DELTAs that `predict_state_config` streams while `write_document`
    is still generating are JSON-patch ``replace`` ops on ``/document``,
    which the frontend rejects when the path does not yet exist ("Failed to
    apply state patch ... op: replace" against ``{}``), so the run never
    settles. langgraph-python avoids this because its typed LangGraph
    ``State`` seeds ``document = ""``.

    We mirror that seed by emitting a ``STATE_SNAPSHOT`` carrying the current
    ``document`` value (``""`` on the first turn) immediately after
    ``RUN_STARTED`` and before the predictive deltas stream.

    KNOWN LIMITATION (MAF ``agent_framework_ag_ui`` rc8): this seed fixes the
    single-turn path — the document now streams token-by-token and the run
    settles. A *second* turn still hangs the harness completion gate: the
    agent emits a clean, correlated ``RUN_FINISHED`` (verified via direct SSE
    capture) but the CopilotKit frontend does not clear
    ``data-copilot-running`` after the second turn, so the probe reds with
    ``done-signal-missing``. The demo frontend is byte-identical to the
    passing langgraph-python demo, so the divergence is in the MAF AG-UI
    adapter's run-completion emission, below the showcase layer. langgraph's
    CopilotKit adapter does not exhibit this. Until the adapter is fixed
    upstream, the D6 cell stays quarantined in ``not_supported_features``.
    """

    async def run(  # type: ignore[override]
        self,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[BaseEvent, None]:
        incoming = input_data.get("state")
        state = incoming if isinstance(incoming, dict) else {}
        # Seed on EVERY turn (preserving any existing document) so the
        # `/document` path always exists before the predictive STATE_DELTAs
        # stream. `{**state, "document": state.get("document", "")}` keeps a
        # prior turn's committed document intact while guaranteeing the key is
        # present for turn 1's empty state.
        document = state.get("document", "")
        seeded = False
        async for event in super().run(input_data):
            yield event
            # Inject the seed snapshot immediately AFTER RUN_STARTED — the
            # AG-UI protocol requires RUN_STARTED to be the first event, and
            # the seed must land before the predictive STATE_DELTAs stream.
            if (
                not seeded
                and getattr(event, "type", None) == EventType.RUN_STARTED
            ):
                yield StateSnapshotEvent(
                    type=EventType.STATE_SNAPSHOT,
                    snapshot={**state, "document": document},
                )
                seeded = True


def create_shared_state_streaming_agent(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the shared-state-streaming MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="shared_state_streaming_agent",
        instructions=SYSTEM_PROMPT,
        tools=[write_document],
    )

    return SharedStateStreamingFrameworkAgent(
        agent=base_agent,
        name="SharedStateStreamingAgent",
        description=(
            "Per-token state streaming: `write_document` arg deltas land "
            "in `state.document` as the tool call is generated."
        ),
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
