"""AG-UI base + CopilotKit override contract (PNI-545).

Dictionaries merge recursively; lists/serialized values are atomic. These
checks intentionally never pair unrelated context entries by list index.
"""

import json
from copy import deepcopy

import pytest
from ag_ui.core import Context
from copilotkit.copilotkit_lg_middleware import CopilotKitMiddleware
from langchain.tools import ToolRuntime
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.prebuilt.tool_node import ToolCallRequest

from .test_copilotkit_lg_middleware import (
    _make_request,
    _RecordingToolAwareChatModel,
    _run_wrap,
)

CATALOG_ID = "copilotkit://app-dashboard-catalog"
CATALOG_TEXT = f"Available A2UI catalog:\n- {CATALOG_ID}\n  - Text: {{...}}"
CATALOG_CONTEXT = [{"description": "A2UI catalog capabilities", "value": CATALOG_TEXT}]


@pytest.mark.parametrize("namespace", ["ag-ui", "copilotkit"])
def test_single_namespace_context_and_actions(namespace):
    state = {namespace: {"context": CATALOG_CONTEXT, "actions": [{"name": "frontend"}]}}
    seen, _ = _run_wrap(CopilotKitMiddleware(), _make_request(state=state))
    assert seen.tools == [{"name": "frontend"}]
    assert CATALOG_ID in seen.system_message.content
    assert CopilotKitMiddleware._resolve_a2ui_catalog(state) == (
        CATALOG_TEXT,
        CATALOG_ID,
    )


def test_disjoint_properties_and_recursive_conflicting_leaves_do_not_mutate():
    state = {
        "ag-ui": {
            "context": {"settings": {"base": 1, "conflict": "ag"}},
            "only_ag": [1],
        },
        "copilotkit": {
            "context": {"settings": {"cpk": 2, "conflict": False}},
            "actions": [],
        },
    }
    original = deepcopy(state)
    result = CopilotKitMiddleware._get_copilotkit_context(state)
    assert result == {
        "context": {"settings": {"base": 1, "cpk": 2, "conflict": False}},
        "only_ag": [1],
        "actions": [],
    }
    result["context"]["settings"]["base"] = 999
    result["only_ag"].append(2)
    assert state == original


@pytest.mark.parametrize("override", [False, None, "", [], 0, "serialized JSON"])
def test_non_mapping_leaves_replace_including_empty_values(override):
    state = {"ag-ui": {"context": {"base": 1}}, "copilotkit": {"context": override}}
    assert CopilotKitMiddleware._get_copilotkit_context(state)["context"] == override


def test_lists_replace_without_pairing_or_concatenation():
    override = [{"description": "unrelated viewer", "value": "admin"}]
    state = {"ag-ui": {"context": CATALOG_CONTEXT}, "copilotkit": {"context": override}}
    assert CopilotKitMiddleware._get_copilotkit_context(state)["context"] == override
    assert CopilotKitMiddleware._resolve_a2ui_catalog(state) is None


@pytest.mark.parametrize("carrier", ["runtime", "context", "configurable"])
@pytest.mark.parametrize("legacy", [False, True])
def test_carrier_fallback_preserves_namespaces_and_input(monkeypatch, carrier, legacy):
    cpk = {"context": {"cpk": 2, "conflict": False}}
    payload = cpk if legacy else {"copilotkit": cpk}
    config = {} if carrier == "runtime" else {carrier: payload}
    runtime = payload if carrier == "runtime" else None
    state = {"ag-ui": {"context": {"ag": 1, "conflict": True}}}
    before = deepcopy((state, runtime, config))
    monkeypatch.setattr("langgraph.config.get_config", lambda: config)
    assert CopilotKitMiddleware._get_copilotkit_context(state, runtime)["context"] == {
        "ag": 1,
        "cpk": 2,
        "conflict": False,
    }
    assert (state, runtime, config) == before


def test_state_empty_leaf_blocks_stale_carrier(monkeypatch):
    monkeypatch.setattr(
        "langgraph.config.get_config",
        lambda: {"context": {"copilotkit": {"context": CATALOG_CONTEXT}}},
    )
    state = {"ag-ui": {"context": CATALOG_CONTEXT}, "copilotkit": {"context": []}}
    assert CopilotKitMiddleware._get_copilotkit_context(state)["context"] == []


def test_bookkeeping_does_not_hide_subgraph_runtime_context():
    state = {"copilotkit": {"intercepted_tool_calls": None}}
    result = CopilotKitMiddleware._get_copilotkit_context(
        state, {"copilotkit": {"context": CATALOG_CONTEXT}}
    )
    assert result["context"] == CATALOG_CONTEXT


@pytest.mark.parametrize(
    "context",
    [
        CATALOG_CONTEXT,
        json.dumps(CATALOG_CONTEXT),
        [Context(**CATALOG_CONTEXT[0])],
        [{"description": "A2UI catalog", "value": json.dumps(CATALOG_TEXT)}],
    ],
)
def test_catalog_wire_and_serialized_context(context):
    assert CopilotKitMiddleware._resolve_a2ui_catalog(
        {"ag-ui": {"context": context}}
    ) == (CATALOG_TEXT, CATALOG_ID)


@pytest.mark.parametrize(
    "context",
    [
        None,
        False,
        42,
        {},
        "not JSON",
        [{"description": 3, "value": "x"}],
        [{"description": "A2UI catalog", "value": {"catalogId": "x"}}],
    ],
)
def test_non_catalog_context_is_not_reinterpreted(context):
    assert (
        CopilotKitMiddleware._resolve_a2ui_catalog({"ag-ui": {"context": context}})
        is None
    )


@pytest.mark.parametrize("flag", [False, None, ""])
def test_copilotkit_false_injection_overrides_agui(flag):
    state = {
        "ag-ui": {"inject_a2ui_tool": True, "context": CATALOG_CONTEXT},
        "copilotkit": {"inject_a2ui_tool": flag},
    }
    seen, _ = _run_wrap(CopilotKitMiddleware(), _make_request(state=state))
    assert seen.tools == []


def test_native_schema_recursively_merges_with_copilotkit():
    state = {
        "ag-ui": {"a2ui_schema": {"catalogId": "ag", "components": ["Text"]}},
        "copilotkit": {"a2ui_schema": {"catalogId": "cpk"}},
    }
    assert CopilotKitMiddleware._resolve_a2ui_catalog(state) == (None, "cpk")
    assert CopilotKitMiddleware._get_copilotkit_context(state)["a2ui_schema"][
        "components"
    ] == ["Text"]


class _CatalogModel(_RecordingToolAwareChatModel):
    """Deterministic model; the real AG-UI tool still builds the native envelope."""

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.last_messages = list(messages)
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "id": "render-call",
                                "name": "render_a2ui",
                                "args": {
                                    "surfaceId": "dashboard",
                                    "components": [
                                        {
                                            "id": "root",
                                            "component": "Text",
                                            "text": "Sales Dashboard",
                                        }
                                    ],
                                },
                            }
                        ],
                    )
                )
            ]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("native_schema", [False, True])
async def test_real_native_tool_result_and_serialized_replay(native_schema):
    properties = {"inject_a2ui_tool": True, "context": CATALOG_CONTEXT}
    state = {
        "messages": [HumanMessage(content="Create a dashboard"), AIMessage(content="")],
        "ag-ui": properties,
    }
    if native_schema:
        properties["a2ui_schema"] = {"catalogId": "ag", "components": ["BaseComponent"]}
        state["copilotkit"] = {"a2ui_schema": {"catalogId": CATALOG_ID}}
    original = deepcopy(state)
    model = _CatalogModel()
    middleware = CopilotKitMiddleware()
    request = _make_request(state=state).override(model=model)
    seen, _ = _run_wrap(middleware, request)
    assert any(getattr(tool, "name", None) == "generate_a2ui" for tool in seen.tools)
    runtime = ToolRuntime(
        state=state,
        context=None,
        config={},
        stream_writer=lambda _: None,
        tool_call_id="native-call",
        store=None,
    )
    tool_request = ToolCallRequest(
        tool_call={"name": "generate_a2ui", "id": "native-call", "args": {}},
        tool=None,
        state=state,
        runtime=runtime,
    )

    async def execute(resolved):
        return await resolved.tool.ainvoke(
            {
                **resolved.tool_call,
                "type": "tool_call",
                "args": {"runtime": resolved.runtime},
            }
        )

    native = await middleware.awrap_tool_call(tool_request, execute)
    assert isinstance(native, ToolMessage)
    replay = ToolMessage.model_validate(json.loads(native.model_dump_json()))
    assert replay.tool_call_id == "native-call"
    assert replay.content == native.content
    operations = json.loads(replay.content)["a2ui_operations"]
    assert operations[0]["createSurface"]["catalogId"] == CATALOG_ID
    assert operations[1]["updateComponents"]["components"] == [
        {"id": "root", "component": "Text", "text": "Sales Dashboard"}
    ]
    if native_schema:
        assert "BaseComponent" in model.last_messages[0].content
        assert CATALOG_ID in model.last_messages[0].content
    assert state == original
    assert runtime.state is state
    middleware.after_agent(state, runtime)


@pytest.mark.parametrize("namespace", [None, {}, [], False])
def test_missing_or_empty_namespace_preserves_agui(namespace):
    state = {"ag-ui": {"context": CATALOG_CONTEXT}, "copilotkit": namespace}
    assert CopilotKitMiddleware._resolve_a2ui_catalog(state) == (
        CATALOG_TEXT,
        CATALOG_ID,
    )


def test_serialized_mapping_is_an_atomic_leaf():
    state = {"ag-ui": {"context": '{"ag": 1}'}, "copilotkit": {"context": '{"cpk": 2}'}}
    assert (
        CopilotKitMiddleware._get_copilotkit_context(state)["context"] == '{"cpk": 2}'
    )


@pytest.mark.asyncio
async def test_runtime_properties_drive_async_tool_and_catalog_consumers():
    state = {"messages": []}
    request = _make_request(state=state)
    request.runtime.context = {
        "ag-ui": {
            "inject_a2ui_tool": True,
            "context": CATALOG_CONTEXT,
            "actions": [{"name": "render_custom"}],
        },
        "copilotkit": {"inject_a2ui_tool": "render_custom"},
    }
    seen = []

    async def capture(resolved):
        seen.append(resolved)
        return "ok"

    middleware = CopilotKitMiddleware()
    await middleware.awrap_model_call(request, capture)
    assert len(seen[0].tools) == 1
    assert seen[0].tools[0].name == "generate_a2ui"
    assert CATALOG_ID in seen[0].system_message.content
    middleware.after_agent(state, request.runtime)


@pytest.mark.parametrize("actions", [None, False, []])
def test_empty_actions_do_not_restore_agui_frontend_tools(actions):
    state = {
        "messages": [],
        "ag-ui": {"inject_a2ui_tool": True, "actions": [{"name": "render_a2ui"}]},
        "copilotkit": {"actions": actions},
    }
    middleware = CopilotKitMiddleware()
    seen, _ = _run_wrap(middleware, _make_request(state=state))
    assert len(seen.tools) == 1
    assert seen.tools[0].name == "generate_a2ui"
    middleware.after_agent(state, None)


def test_agui_frontend_actions_intercept_and_restore_identity():
    call = {"name": "frontend", "id": "frontend-call", "args": {"value": 42}}
    original = AIMessage(content="", tool_calls=[call], id="assistant-id")
    state = {"ag-ui": {"actions": [{"name": "frontend"}]}, "messages": [original]}
    middleware = CopilotKitMiddleware()
    update = middleware.after_model(state, None)
    assert update["messages"][0].tool_calls == []
    restored = middleware.after_agent({**state, **update}, None)
    assert restored["messages"][0].tool_calls == original.tool_calls
    assert restored["messages"][0].id == "assistant-id"
    assert original.tool_calls[0]["id"] == "frontend-call"
