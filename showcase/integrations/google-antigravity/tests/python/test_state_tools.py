"""Server tools that write shared state or emit A2UI, run through the adapter.

Each tool is wrapped by the adapter's UIBridge exactly as AntigravityAgent
wraps it at runtime, so experimental_get_state()/experimental_set_state()
resolve to a real session and the emitted events are the ones a client would receive.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from ag_ui_antigravity import UIBridge

from agents import a2ui_fixed, beautiful_chat, subagents


# CI installs pytest-asyncio but sets no asyncio_mode, so async tests are
# marked explicitly.


def _types(events):
    return [e.type if isinstance(e.type, str) else e.type.value for e in events]


def _snapshots(events):
    return [e.snapshot for e in events if _types([e]) == ["STATE_SNAPSHOT"]]


class _FakeGemini:
    """Stands in for aimock: answers every generateContent call with `content`."""

    def __init__(self, content="", status=200):
        self.content = content
        self.status = status
        self.requests = []

    async def post(self, url, json=None, headers=None):
        self.requests.append({"url": url, "json": json, "headers": headers})
        return httpx.Response(
            self.status,
            json={
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {"text": "thinking it over", "thought": True},
                                {"text": self.content},
                            ],
                        }
                    }
                ]
            },
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def completions(monkeypatch):
    fake = _FakeGemini("- fact one\n- fact two")
    monkeypatch.setattr(subagents, "_http_client", lambda: fake)
    monkeypatch.setattr(subagents, "gemini_base_url", lambda: "http://aimock.test")
    monkeypatch.setattr(subagents, "api_key", lambda: "fake-gemini-key")
    return fake


@pytest.mark.asyncio
class TestSubagentDelegations:
    async def test_each_delegation_is_appended_and_streamed(self, completions):
        bridge = UIBridge()
        research, writing = bridge.build_server_tools(
            [subagents.research_agent, subagents.writing_agent]
        )

        assert await research(task="topic") == "- fact one\n- fact two"
        completions.content = "A draft."
        await writing(task="write it")

        events = bridge.drain()
        snapshots = _snapshots(events)
        assert len(snapshots) == 2
        final = snapshots[-1]["delegations"]
        assert [d["sub_agent"] for d in final] == ["research_agent", "writing_agent"]
        assert final[1] == {
            "id": final[1]["id"],
            "sub_agent": "writing_agent",
            "task": "write it",
            "status": "completed",
            "result": "A draft.",
        }
        # The log updates as each tool finishes, not after the turn.
        first_result = _types(events).index("TOOL_CALL_RESULT")
        assert _types(events).index("STATE_SNAPSHOT") < first_result

    async def test_existing_state_keys_survive(self, completions):
        bridge = UIBridge()
        bridge.adopt_client_state({"delegations": [], "other": 1})
        (research,) = bridge.build_server_tools([subagents.research_agent])
        await research(task="topic")
        (snapshot,) = _snapshots(bridge.drain())
        assert snapshot["other"] == 1

    async def test_concurrent_delegations_do_not_drop_each_other(self, completions):
        bridge = UIBridge()
        tools = bridge.build_server_tools(
            [subagents.research_agent, subagents.critique_agent]
        )
        await asyncio.gather(tools[0](task="a"), tools[1](task="b"))
        final = _snapshots(bridge.drain())[-1]["delegations"]
        assert sorted(d["sub_agent"] for d in final) == [
            "critique_agent",
            "research_agent",
        ]

    async def test_empty_output_is_recorded_with_the_sentinel(self, completions):
        completions.content = "   "
        bridge = UIBridge()
        (critique,) = bridge.build_server_tools([subagents.critique_agent])
        assert await critique(task="review") == subagents.SUB_AGENT_EMPTY_SENTINEL
        (snapshot,) = _snapshots(bridge.drain())
        assert (
            snapshot["delegations"][0]["result"] == subagents.SUB_AGENT_EMPTY_SENTINEL
        )

    async def test_a_failed_call_records_nothing_and_reports_the_error(
        self, completions
    ):
        completions.status = 500
        bridge = UIBridge()
        (research,) = bridge.build_server_tools([subagents.research_agent])
        with pytest.raises(httpx.HTTPStatusError):
            await research(task="topic")
        events = bridge.drain()
        assert _snapshots(events) == []
        result = [e for e in events if _types([e]) == ["TOOL_CALL_RESULT"]][0]
        assert "There was an error executing research_agent" in result.content

    async def test_the_call_is_a_gemini_request_with_the_aimock_context(
        self, completions
    ):
        bridge = UIBridge()
        (research,) = bridge.build_server_tools([subagents.research_agent])
        await research(task="topic")
        (request,) = completions.requests
        assert request["url"] == (
            f"http://aimock.test/v1beta/models/{subagents.MODEL}:generateContent"
        )
        assert request["headers"] == {
            "X-AIMock-Context": "google-antigravity",
            "x-goog-api-key": "fake-gemini-key",
        }
        assert request["json"]["contents"] == [
            {"role": "user", "parts": [{"text": "topic"}]}
        ]
        assert request["json"]["systemInstruction"] == {
            "parts": [{"text": subagents._ROLE_PROMPTS["research_agent"]}]
        }

    async def test_without_a_base_url_the_call_goes_to_google(
        self, completions, monkeypatch
    ):
        monkeypatch.setattr(subagents, "gemini_base_url", lambda: None)
        bridge = UIBridge()
        (research,) = bridge.build_server_tools([subagents.research_agent])
        await research(task="topic")
        (request,) = completions.requests
        assert request["url"].startswith(
            "https://generativelanguage.googleapis.com/v1beta/models/"
        )


@pytest.mark.asyncio
class TestBeautifulChatTodos:
    async def test_manage_todos_writes_the_todos_slot_and_fills_missing_ids(self):
        bridge = UIBridge()
        bridge.adopt_client_state({"theme": "dark"})
        (manage,) = bridge.build_server_tools([beautiful_chat.manage_todos])
        await manage(
            todos=[
                {"id": "", "title": "Read the docs", "status": "pending"},
                {"id": "keep", "title": "Build", "status": "completed"},
            ]
        )
        (snapshot,) = _snapshots(bridge.drain())
        assert snapshot["theme"] == "dark"
        ids = [t["id"] for t in snapshot["todos"]]
        assert ids[0] and ids[0] != "keep"
        assert ids[1] == "keep"

    async def test_get_todos_reads_what_the_ui_sent(self):
        bridge = UIBridge()
        # The canvas writes user edits back with agent.setState; the next run
        # carries them as RunAgentInput.state.
        bridge.adopt_client_state({"todos": [{"id": "1", "title": "From the UI"}]})
        (get_todos,) = bridge.build_server_tools([beautiful_chat.get_todos])
        assert await get_todos() == [{"id": "1", "title": "From the UI"}]

    async def test_get_todos_defaults_to_empty(self):
        bridge = UIBridge()
        (get_todos,) = bridge.build_server_tools([beautiful_chat.get_todos])
        assert await get_todos() == []


class TestA2UIFixedSchema:
    @pytest.mark.asyncio
    async def test_display_flight_emits_a_v09_surface_the_middleware_detects(self):
        bridge = UIBridge()
        (display,) = bridge.build_server_tools([a2ui_fixed.display_flight])
        await display(origin="SFO", destination="JFK", airline="United", price="$289")

        result = [e for e in bridge.drain() if _types([e]) == ["TOOL_CALL_RESULT"]][0]
        ops = json.loads(result.content)["a2ui_operations"]
        assert [next(k for k in op if k != "version") for op in ops] == [
            "createSurface",
            "updateComponents",
            "updateDataModel",
        ]
        assert all(op["version"] == "v0.9" for op in ops)
        assert ops[0]["createSurface"] == {
            "surfaceId": a2ui_fixed.SURFACE_ID,
            # Must match the catalog the page registers, or nothing renders.
            "catalogId": "copilotkit://flight-fixed-catalog",
        }
        assert ops[1]["updateComponents"]["components"] == a2ui_fixed.FLIGHT_SCHEMA
        assert ops[2]["updateDataModel"]["value"] == {
            "origin": "SFO",
            "destination": "JFK",
            "airline": "United",
            "price": "$289",
        }

    def test_the_catalog_id_matches_the_page(self):
        import pathlib

        catalog = (
            pathlib.Path(__file__).resolve().parents[2]
            / "src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts"
        ).read_text()
        assert a2ui_fixed.CATALOG_ID in catalog
