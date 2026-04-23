"""Tests for the Python runtime info discovery contract."""

from typing import Optional, List

from copilotkit.agent import Agent
from copilotkit.action import ActionDict
from copilotkit.html import generate_info_html
from copilotkit.sdk import CopilotKitRemoteEndpoint
from copilotkit.types import Message, MetaEvent


class DummyAgent(Agent):
    """Minimal concrete agent for runtime info tests."""

    def execute(
        self,
        *,
        state: dict,
        config: Optional[dict] = None,
        messages: List[Message],
        thread_id: str,
        actions: Optional[List[ActionDict]] = None,
        meta_events: Optional[List[MetaEvent]] = None,
        **kwargs,
    ):
        return iter(())

    async def get_state(self, *, thread_id: str):
        return {
            "threadId": thread_id or "",
            "threadExists": False,
            "state": {},
            "messages": [],
        }


def test_runtime_info_matches_js_runtime_contract():
    sdk = CopilotKitRemoteEndpoint(
        agents=[DummyAgent(name="my_agent", description="A helpful agent.")],
    )

    info = sdk.info(
        context={
            "properties": {},
            "frontend_url": None,
            "headers": {},
        }
    )

    assert info["version"]
    assert info["audioFileTranscriptionEnabled"] is False
    assert info["mode"] == "sse"
    assert info["a2uiEnabled"] is False
    assert info["agents"]["my_agent"] == {
        "name": "my_agent",
        "description": "A helpful agent.",
        "className": "DummyAgent",
    }

    # Legacy keys remain available during the contract transition.
    assert info["sdkVersion"] == info["version"]
    assert info["actions"] == []


def test_generate_info_html_supports_runtime_info_contract():
    sdk = CopilotKitRemoteEndpoint(
        agents=[DummyAgent(name="my_agent", description="A helpful agent.")],
    )
    info = sdk.info(
        context={
            "properties": {},
            "frontend_url": None,
            "headers": {},
        }
    )

    html = generate_info_html(info)

    assert "my_agent" in html
    assert "DummyAgent" in html
    assert info["version"] in html