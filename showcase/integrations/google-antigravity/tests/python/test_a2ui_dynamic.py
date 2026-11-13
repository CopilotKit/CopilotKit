"""generate_a2ui (declarative-gen-ui, a2ui-recovery), run through the adapter.

The tool is wrapped by the adapter's UIBridge exactly as AntigravityAgent
wraps it, so experimental_get_context() resolves to the run's context and the
TOOL_CALL_RESULT is the one the A2UI middleware would read. A fake client
stands in for aimock's generateContent endpoint.
"""

from __future__ import annotations

import json

import httpx
import pytest
from ag_ui_antigravity import UIBridge

from agents import a2ui_dynamic

SCHEMA_DESCRIPTION = (
    "A2UI Component Schema — available components for generating UI surfaces. "
    "Use these component names and properties when creating A2UI operations."
)
SALES = {"description": "Sales dataset for Vantage Threads", "value": "Revenue $4.2M"}
SCHEMA = {
    "description": SCHEMA_DESCRIPTION,
    "value": json.dumps({"catalogId": "declarative-gen-ui-catalog", "components": {}}),
}

VALID = [
    {"id": "root", "component": "Column", "children": ["m1"]},
    {"id": "m1", "component": "Metric", "label": "Revenue", "value": "$4.2M"},
]
INVALID = [{"id": "root", "component": "Column", "children": ["missing-metric"]}]


def _types(events):
    return [e.type if isinstance(e.type, str) else e.type.value for e in events]


def _render_call(components, *, as_string=True, data=None):
    return {
        "functionCall": {
            "name": "render_a2ui",
            "args": {
                "surfaceId": "sales-dashboard",
                "components": json.dumps(components) if as_string else components,
                "data": json.dumps(data or {}) if as_string else (data or {}),
            },
        }
    }


class _FakeGemini:
    """Answers each generateContent call with the next scripted parts list."""

    def __init__(self, *answers, status=200):
        self.answers = list(answers)
        self.status = status
        self.requests = []

    async def post(self, url, json=None, headers=None):
        self.requests.append({"url": url, "json": json, "headers": headers})
        parts = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        return httpx.Response(
            self.status,
            json={"candidates": [{"content": {"role": "model", "parts": parts}}]},
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def gemini(monkeypatch):
    fake = _FakeGemini([_render_call(VALID)])
    monkeypatch.setattr(a2ui_dynamic, "_http_client", lambda: fake)
    monkeypatch.setattr(a2ui_dynamic, "gemini_base_url", lambda: "http://aimock.test")
    monkeypatch.setattr(a2ui_dynamic, "api_key", lambda: "fake-gemini-key")
    return fake


async def _run(request="Show me my sales dashboard for this quarter."):
    bridge = UIBridge()
    bridge.adopt_client_context([SALES, SCHEMA])
    (tool,) = bridge.build_server_tools([a2ui_dynamic.generate_a2ui])
    result = await tool(request=request)
    return result, bridge.drain()


@pytest.mark.asyncio
class TestGenerateA2UI:
    async def test_a_valid_render_becomes_an_operations_container(self, gemini):
        result, events = await _run()
        ops = result["a2ui_operations"]
        assert ops[0]["createSurface"] == {
            "surfaceId": "sales-dashboard",
            "catalogId": "declarative-gen-ui-catalog",
        }
        assert ops[1]["updateComponents"]["components"] == VALID
        # The middleware reads the container from the tool result's content.
        (content,) = [e.content for e in events if _types([e]) == ["TOOL_CALL_RESULT"]]
        assert json.loads(content) == result

    async def test_the_catalog_id_comes_from_the_page_schema(self, gemini):
        bridge = UIBridge()
        schema = {**SCHEMA, "value": json.dumps({"catalogId": "other-catalog"})}
        bridge.adopt_client_context([schema])
        (tool,) = bridge.build_server_tools([a2ui_dynamic.generate_a2ui])
        result = await tool(request="dashboard")
        assert result["a2ui_operations"][0]["createSurface"]["catalogId"] == (
            "other-catalog"
        )

    async def test_without_a_schema_entry_the_default_catalog_is_used(self, gemini):
        bridge = UIBridge()
        (tool,) = bridge.build_server_tools([a2ui_dynamic.generate_a2ui])
        result = await tool(request="dashboard")
        assert result["a2ui_operations"][0]["createSurface"]["catalogId"] == (
            a2ui_dynamic.CATALOG_ID
        )

    async def test_the_inner_call_is_forced_onto_render_a2ui(self, gemini):
        await _run("How are our reps doing?")
        (request,) = gemini.requests
        assert request["url"] == (
            f"http://aimock.test/v1beta/models/{a2ui_dynamic.MODEL}:generateContent"
        )
        assert request["headers"] == {
            "x-aimock-context": "google-antigravity",
            "x-goog-api-key": "fake-gemini-key",
        }
        body = request["json"]
        assert body["contents"] == [
            {"role": "user", "parts": [{"text": "How are our reps doing?"}]}
        ]
        assert body["toolConfig"] == {
            "functionCallingConfig": {
                "mode": "ANY",
                "allowedFunctionNames": ["render_a2ui"],
            }
        }
        (declaration,) = body["tools"][0]["functionDeclarations"]
        assert declaration["name"] == "render_a2ui"
        assert declaration["parameters"]["properties"]["components"]["type"] == "STRING"

    async def test_the_prompt_carries_the_app_context_and_the_catalog(self, gemini):
        await _run()
        prompt = gemini.requests[0]["json"]["systemInstruction"]["parts"][0]["text"]
        assert "## Sales dataset for Vantage Threads\nRevenue $4.2M" in prompt
        assert "## Available Components" in prompt
        assert "declarative-gen-ui-catalog" in prompt
        # The schema entry is routed to Available Components, not repeated as
        # a generic context section.
        assert f"## {SCHEMA_DESCRIPTION}" not in prompt

    async def test_structured_args_are_accepted_too(self, gemini):
        gemini.answers = [[_render_call(VALID, as_string=False)]]
        result, _ = await _run()
        assert result["a2ui_operations"][1]["updateComponents"]["components"] == VALID

    async def test_an_invalid_render_is_retried_with_the_errors(self, gemini):
        gemini.answers = [[_render_call(INVALID)], [_render_call(VALID)]]
        result, _ = await _run()
        assert "a2ui_operations" in result
        assert len(gemini.requests) == 2
        first, retry = (
            r["json"]["systemInstruction"]["parts"][0]["text"] for r in gemini.requests
        )
        assert "Previous attempt was invalid" not in first
        assert "## Previous attempt was invalid" in retry
        assert "missing-metric" in retry

    async def test_an_always_invalid_render_exhausts_the_recovery(self, gemini):
        gemini.answers = [[_render_call(INVALID)]]
        result, events = await _run()
        assert result["code"] == "a2ui_recovery_exhausted"
        assert len(result["attempts"]) == a2ui_dynamic.MAX_ATTEMPTS
        assert len(gemini.requests) == a2ui_dynamic.MAX_ATTEMPTS
        (content,) = [e.content for e in events if _types([e]) == ["TOOL_CALL_RESULT"]]
        assert json.loads(content)["code"] == "a2ui_recovery_exhausted"

    async def test_no_render_call_counts_as_a_failed_attempt(self, gemini):
        gemini.answers = [[{"text": "Here is a dashboard."}]]
        result, _ = await _run()
        assert result["code"] == "a2ui_recovery_exhausted"
        assert result["attempts"][0]["errors"][0]["code"] == "empty_components"

    async def test_a_failing_endpoint_ends_in_the_failure_card_not_a_crash(
        self, gemini
    ):
        gemini.status = 500
        result, _ = await _run()
        assert result["code"] == "a2ui_recovery_exhausted"
        assert len(gemini.requests) == a2ui_dynamic.MAX_ATTEMPTS


class TestCoerceRenderArgs:
    def test_json_strings_become_structures(self):
        args = a2ui_dynamic.coerce_render_args(
            {"components": json.dumps(VALID), "data": '{"a": 1}'}
        )
        assert args == {"components": VALID, "data": {"a": 1}}

    def test_a_lone_component_is_wrapped(self):
        args = a2ui_dynamic.coerce_render_args({"components": json.dumps(VALID[0])})
        assert args["components"] == [VALID[0]]

    def test_unparseable_json_is_left_for_the_validator(self):
        args = a2ui_dynamic.coerce_render_args({"components": "[{oops"})
        assert args["components"] == "[{oops"
