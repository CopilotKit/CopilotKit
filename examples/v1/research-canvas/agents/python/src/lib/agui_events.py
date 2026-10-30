"""
The AG-UI LangGraph events this agent sends to the UI.

`@ag-ui/langgraph` (and `ag_ui_langgraph` on the Python side) turn these into
AG-UI events: a state snapshot, a streamed message, and a tool argument that
streams into state while the model writes it.
"""

import asyncio
import uuid
from typing import Any, List, TypedDict

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.runnables import RunnableConfig


class PredictedState(TypedDict):
    """A tool argument to stream into `state_key` while the model writes it."""

    state_key: str
    tool: str
    tool_argument: str


def with_predicted_state(
    config: RunnableConfig, items: List[PredictedState]
) -> RunnableConfig:
    """The config, set to stream each tool argument into its state key."""
    metadata = {**config.get("metadata", {}), "predict_state": items}
    return {**config, "metadata": metadata}


async def emit_state(config: RunnableConfig, state: Any) -> None:
    """Send the current state to the UI before the node returns."""
    await adispatch_custom_event("manually_emit_state", state, config=config)
    # Give the event loop a turn so the event goes out before the node moves on.
    await asyncio.sleep(0.02)


async def emit_message(config: RunnableConfig, message: str) -> None:
    """Send an assistant message to the UI. The node must still return it."""
    await adispatch_custom_event(
        "manually_emit_message",
        {"message": message, "message_id": str(uuid.uuid4()), "role": "assistant"},
        config=config,
    )
    await asyncio.shield(asyncio.sleep(0.02))
