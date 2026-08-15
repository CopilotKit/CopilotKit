"""Contracts for CrewAI Flows backing state and multimodal D6 cells."""

import ast
import asyncio
import json
import re
import threading
import time

from pathlib import Path
from types import SimpleNamespace

import pytest

from agents.tools.custom_tool import _generate_a2ui_completion_params
from tools import RENDER_A2UI_TOOL_SCHEMA


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"
MULTIMODAL_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-multimodal" / "route.ts"
)
MULTIMODAL_PAGE = INTEGRATION_ROOT / "src" / "app" / "demos" / "multimodal" / "page.tsx"
A2UI_RECOVERY_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-a2ui-recovery" / "route.ts"
)
MAIN_RUNTIME_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit" / "route.ts"
)
OPEN_GEN_UI_RUNTIME_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-ogui" / "route.ts"
)
MCP_APPS_RUNTIME_ROUTE = (
    INTEGRATION_ROOT / "src" / "app" / "api" / "copilotkit-mcp-apps" / "route.ts"
)
DOCKERFILE = INTEGRATION_ROOT / "Dockerfile"


def _response(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def test_generate_a2ui_completion_params_reuses_canonical_schema():
    params = _generate_a2ui_completion_params("Build a sales dashboard.")

    assert params["tools"] == [
        {"type": "function", "function": RENDER_A2UI_TOOL_SCHEMA}
    ]
    assert params["tools"][0]["function"] is RENDER_A2UI_TOOL_SCHEMA


def test_every_crewai_agent_is_explicitly_pinned_to_gpt_5_4():
    missing_or_wrong = []
    for source_path in sorted((INTEGRATION_ROOT / "src" / "agents").glob("*.py")):
        tree = ast.parse(source_path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Name) or node.func.id != "Agent":
                continue
            llm = next((kw.value for kw in node.keywords if kw.arg == "llm"), None)
            if not isinstance(llm, ast.Constant) or llm.value != "gpt-5.4":
                missing_or_wrong.append(f"{source_path.name}:{node.lineno}")

    assert missing_or_wrong == []


def test_beautiful_chat_routes_registered_frontend_actions_and_canonical_flights():
    from agents.beautiful_chat import BEAUTIFUL_CHAT_BACKSTORY
    from agents.tools.custom_tool import SearchFlightsTool

    assert (
        "call the frontend `pieChart` or `barChart` action" in BEAUTIFUL_CHAT_BACKSTORY
    )
    assert "call the frontend `scheduleTime` action" in BEAUTIFUL_CHAT_BACKSTORY
    assert "call the frontend `toggleTheme` action" in BEAUTIFUL_CHAT_BACKSTORY
    assert "Theme toggled" in BEAUTIFUL_CHAT_BACKSTORY
    assert "United" in BEAUTIFUL_CHAT_BACKSTORY
    assert "$349" in BEAUTIFUL_CHAT_BACKSTORY
    assert "Delta" in BEAUTIFUL_CHAT_BACKSTORY
    assert "$289" in BEAUTIFUL_CHAT_BACKSTORY

    result = json.loads(
        SearchFlightsTool()._run(
            flights=[
                {
                    "airline": "Invented Air",
                    "origin": "SFO",
                    "destination": "JFK",
                    "price": "$999",
                }
            ]
        )
    )
    flights = result["a2ui_operations"][-1]["updateDataModel"]["value"]["flights"]
    assert [(flight["airline"], flight["price"]) for flight in flights] == [
        ("United", "$349"),
        ("Delta", "$289"),
    ]


def test_crewai_image_packages_the_shared_financial_dataset():
    data_link = INTEGRATION_ROOT / "data"

    assert data_link.is_symlink()
    assert (data_link / "db.csv").is_file()
    assert "COPY --chown=app:app data/ /app/data/" in DOCKERFILE.read_text()


def test_live_model_prompts_preserve_probe_semantics():
    from agents.gen_ui_agent import SYSTEM_PROMPT as gen_ui_prompt
    from agents.reasoning_flow import SYSTEM_PROMPT as display_reasoning_prompt
    from agents.tool_rendering import _SYSTEM_PROMPT as rendering_prompt
    from agents.tool_rendering_reasoning import SYSTEM_PROMPT as reasoning_prompt

    for marker in ("launch", "marketing", "venue", "agenda", "competitor", "weakness"):
        assert marker in gen_ui_prompt
    assert "Rendered through the custom wildcard catchall." in rendering_prompt
    assert "high-level rationale" in display_reasoning_prompt
    assert "train and car" in display_reasoning_prompt
    for chain in ("AAPL", "MSFT", "20", "6", "SFO", "JFK"):
        assert chain in reasoning_prompt


@pytest.mark.asyncio
async def test_declarative_gen_ui_forces_the_runtime_injected_tool(monkeypatch):
    from agents import declarative_gen_ui as module

    flow = module.DeclarativeGenUIFlow()
    flow.state.messages = [{"role": "user", "content": "Show me my sales dashboard."}]
    flow.state.copilotkit.actions = [
        {
            "type": "function",
            "function": {
                "name": "render_a2ui",
                "description": "Generate the dashboard surface.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]
    flow.state.context = [
        {
            "description": "Sales dataset",
            "value": "Quarterly revenue is $4.2M.",
        }
    ]
    flow.state.ag_ui = {
        "a2ui_schema": "Metric uses component, label, value, trend, and trendValue."
    }
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_render_a2ui",
                        "type": "function",
                        "function": {"name": "render_a2ui", "arguments": "{}"},
                    }
                ],
            }
        )

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert captured["model"] == "openai/gpt-5.4"
    assert captured["tools"] == flow.state.copilotkit.actions
    assert captured["tool_choice"] == {
        "type": "function",
        "function": {"name": "render_a2ui"},
    }
    assert captured["parallel_tool_calls"] is False
    assert "Quarterly revenue is $4.2M." in captured["messages"][0]["content"]
    assert "Metric uses component" in captured["messages"][0]["content"]
    assert flow.state.messages[-1]["tool_calls"][0]["function"]["name"] == (
        "render_a2ui"
    )


def test_declarative_page_registers_the_shared_sales_context():
    demo_root = INTEGRATION_ROOT / "src/app/demos/declarative-gen-ui"
    chat_source = (demo_root / "chat.tsx").read_text()
    context_source = (demo_root / "sales-context.ts").read_text()

    assert 'from "./sales-context"' in chat_source
    assert "useSalesAnalystContext();" in chat_source
    assert "Quarterly revenue: $4.2M" in context_source
    assert "Dashboard composition rules for A2UI surfaces" in context_source


@pytest.mark.asyncio
async def test_reasoning_stream_persists_current_trace_for_authoritative_snapshot(
    monkeypatch,
):
    from agents import tool_rendering_reasoning as module

    class FakeStream:
        _process_chunk = object()

        def __init__(self):
            self._chunks = iter(
                [
                    SimpleNamespace(
                        type="response.reasoning_summary_text.delta",
                        delta="Inspect the first tool, ",
                    ),
                    SimpleNamespace(
                        type="response.reasoning_summary_text.delta",
                        delta="then compare the result.",
                    ),
                ]
            )

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._chunks)
            except StopIteration as error:
                raise StopAsyncIteration from error

    async def fake_stream(stream):
        assert getattr(stream, "_process_chunk", None) is FakeStream._process_chunk
        async for _chunk in stream:
            pass
        return _response({"role": "assistant", "content": "Compared."})

    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    flow = module.ToolRenderingReasoningFlow()
    flow.state.messages = [{"role": "user", "content": "Compare them."}]

    response = await module._stream_with_snapshot_reasoning(flow, FakeStream())

    assert response.choices[0].message["content"] == "Compared."
    assert flow.state.messages[-1]["role"] == "reasoning"
    assert flow.state.messages[-1]["content"] == (
        "Inspect the first tool, then compare the result."
    )
    assert flow.state.messages[-1]["id"]


@pytest.mark.asyncio
async def test_reasoning_flow_persists_responses_trace_for_terminal_snapshot(
    monkeypatch,
):
    from agents import reasoning_flow as module

    class FakeStream:
        _process_chunk = object()

        def __init__(self):
            self._chunks = iter(
                [
                    SimpleNamespace(
                        type="response.reasoning_text.delta",
                        delta="Check the arithmetic.",
                    )
                ]
            )

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._chunks)
            except StopIteration as error:
                raise StopAsyncIteration from error

    async def fake_responses(**_kwargs):
        return FakeStream()

    async def fake_stream(stream):
        assert getattr(stream, "_process_chunk", None) is FakeStream._process_chunk
        async for _chunk in stream:
            pass
        return _response({"role": "assistant", "content": "It is 4."})

    monkeypatch.setattr(module, "copilotkit_responses", fake_responses)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    flow = module.ReasoningFlow()
    flow.state.messages = [{"role": "user", "content": "What is 2 + 2?"}]

    await flow.chat()

    assert flow.state.messages[-2]["role"] == "reasoning"
    assert flow.state.messages[-2]["content"] == "Check the arithmetic."
    assert flow.state.messages[-1]["content"] == "It is 4."


@pytest.mark.asyncio
async def test_shared_state_read_injects_recipe_into_model_context(monkeypatch):
    from agents import shared_state_read as module

    flow = module.SharedStateReadFlow()
    flow.state.recipe = {
        "title": "Weeknight pasta",
        "ingredients": ["spinach", "tomatoes"],
    }
    flow.state.messages = [{"role": "user", "content": "Make it healthier."}]
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "Add vegetables."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert "Weeknight pasta" in captured["messages"][0]["content"]
    assert "spinach" in captured["messages"][0]["content"]
    assert flow.state.messages[-1]["content"] == "Add vegetables."


@pytest.mark.asyncio
async def test_shared_state_streaming_predicts_and_persists_document(monkeypatch):
    from agents import shared_state_streaming as module

    flow = module.SharedStateStreamingFlow()
    flow.state.messages = [{"role": "user", "content": "Write a poem."}]
    document = "Amber leaves drift quietly across the patient autumn street."
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "Writing now.",
                "tool_calls": [
                    {
                        "id": "call_write_document",
                        "type": "function",
                        "function": {
                            "name": "write_document",
                            "arguments": '{"document":"' + document + '"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Done."}),
    ]
    predicted = []
    emitted = []
    calls = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_predict(items):
        predicted.extend(items)
        return True

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_predict_state", fake_predict)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.write()

    assert predicted == [
        module.StateItem(
            state_key="document",
            tool="write_document",
            tool_argument="document",
        )
    ]
    assert flow.state.document == document
    assert emitted == [("call_write_document", "Document written to shared state.")]
    assert flow.state.messages[-1]["content"] == "Done."


@pytest.mark.asyncio
async def test_tool_rendering_emits_backend_tool_result_before_narration(monkeypatch):
    from agents import tool_rendering as module

    flow = module.ToolRenderingFlow()
    flow.state.messages = [{"role": "user", "content": "What's the weather in Tokyo?"}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_weather",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location":"Tokyo"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Tokyo is sunny."}),
    ]
    emitted = []
    calls = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(tool_call_id, content, **kwargs):
        emitted.append((tool_call_id, content, kwargs))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    tool_names = {tool["function"]["name"] for tool in calls[0]["tools"]}
    assert "get_revenue_chart" in tool_names
    assert calls[0]["tool_choice"] == "required"
    assert calls[1]["tool_choice"] == "auto"
    assert emitted[0][0] == "call_weather"
    assert '"temperature"' in emitted[0][1]
    assert flow.state.messages[-1]["content"] == "Tokyo is sunny."


@pytest.mark.asyncio
async def test_tool_rendering_frontend_resume_does_not_force_another_tool(monkeypatch):
    from agents import tool_rendering as module

    flow = module.ToolRenderingFlow()
    flow.state.messages = [
        {"role": "user", "content": "Highlight this note."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_highlight",
                    "type": "function",
                    "function": {"name": "highlight_note", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_highlight",
            "content": "Highlighted.",
        },
    ]
    calls = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "Done."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert calls[0]["tool_choice"] == "auto"
    assert flow.state.messages[-1]["content"] == "Done."


@pytest.mark.asyncio
async def test_tool_rendering_reasoning_combines_reasoning_and_tool_results(
    monkeypatch,
):
    from agents import tool_rendering_reasoning as module

    flow = module.ToolRenderingReasoningFlow()
    flow.state.messages = [{"role": "user", "content": "Weather in Tokyo?"}]
    responses = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_reasoned_weather",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location":"Tokyo"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Pack for the weather."}),
    ]
    calls = []
    emitted = []

    async def fake_responses(**kwargs):
        calls.append(kwargs)

        class EmptyResponsesStream:
            _process_chunk = object()

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

        return EmptyResponsesStream()

    async def fake_stream(_value):
        return responses.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "copilotkit_responses", fake_responses, raising=False)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert not hasattr(module, "acompletion")
    assert calls[0]["reasoning"] == {"effort": "medium", "summary": "detailed"}
    assert calls[0]["tool_choice"] == "required"
    assert calls[1]["tool_choice"] == "auto"
    assert emitted[0][0] == "call_reasoned_weather"
    assert flow.state.messages[-1]["content"] == "Pack for the weather."


@pytest.mark.asyncio
async def test_tool_rendering_reasoning_requires_the_second_stock_leg(monkeypatch):
    from agents import tool_rendering_reasoning as module

    flow = module.ToolRenderingReasoningFlow()
    flow.state.messages = [
        {"id": "snapshot-only", "role": "reasoning", "content": "Prior trace."},
        {"role": "user", "content": "Compare AAPL and MSFT stocks for me."},
    ]
    responses = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_aapl",
                        "type": "function",
                        "function": {
                            "name": "get_stock_price",
                            "arguments": '{"ticker":"AAPL"}',
                        },
                    }
                ],
            }
        ),
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_msft",
                        "type": "function",
                        "function": {
                            "name": "get_stock_price",
                            "arguments": '{"ticker":"MSFT"}',
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Compared both stocks."}),
    ]
    calls = []

    async def fake_responses(**kwargs):
        calls.append(kwargs)

        class EmptyResponsesStream:
            _process_chunk = object()

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

        return EmptyResponsesStream()

    async def fake_stream(_value):
        return responses.pop(0)

    async def fake_emit(*_args, **_kwargs):
        return True

    monkeypatch.setattr(module, "copilotkit_responses", fake_responses)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert not any(
        message.get("role") == "reasoning" for message in calls[0]["messages"]
    )
    assert calls[1]["tool_choice"] == {
        "type": "function",
        "name": "get_stock_price",
    }
    stock_tool = next(
        tool
        for tool in calls[1]["tools"]
        if tool["function"]["name"] == "get_stock_price"
    )
    assert stock_tool["function"]["strict"] is True
    assert stock_tool["function"]["parameters"]["additionalProperties"] is False
    assert stock_tool["function"]["parameters"]["properties"]["ticker"]["enum"] == [
        "MSFT"
    ]
    # Keep the tool result last so Aimock's toolCallId matcher and Responses
    # conversation semantics both see the prior call being continued.
    assert calls[1]["messages"][-1]["tool_call_id"] == "call_aapl"
    assert not any(
        message.get("role") == "system"
        and "Continue the requested comparison" in message.get("content", "")
        for message in calls[1]["messages"]
    )
    assert calls[2]["tool_choice"] == "auto"


def test_reasoning_chain_detects_tools_on_litellm_message_objects():
    from agents import tool_rendering_reasoning as module

    class MessageLike:
        def __init__(self, value):
            self.value = value

        def get(self, key, default=None):
            return self.value.get(key, default)

    step = module._required_chain_step(
        [
            {"role": "user", "content": "Compare AAPL and MSFT stocks for me."},
            MessageLike(
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "get_stock_price",
                                "arguments": '{"ticker":"AAPL"}',
                            }
                        }
                    ],
                }
            ),
        ]
    )

    assert step is not None
    assert step[2] == {"ticker": "MSFT"}


def test_reasoning_chain_rejects_invalid_tool_argument_json():
    from agents import tool_rendering_reasoning as module

    with pytest.raises(ValueError, match="invalid JSON arguments"):
        module._required_chain_step(
            [
                {"role": "user", "content": "Compare AAPL and MSFT stocks."},
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "get_stock_price",
                                "arguments": "{not-json",
                            }
                        }
                    ],
                },
            ]
        )


@pytest.mark.asyncio
async def test_frontend_tool_flow_suspends_for_browser_owned_result(monkeypatch):
    from agents import frontend_tool_flow as module

    flow = module.FrontendToolFlow()
    flow.state.messages = [{"role": "user", "content": "Search my notes."}]
    flow.state.copilotkit.actions = [
        {"name": "query_notes", "description": "Search notes"}
    ]
    tool_message = {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "call_query_notes",
                "type": "function",
                "function": {
                    "name": "query_notes",
                    "arguments": '{"keyword":"planning"}',
                },
            }
        ],
    }
    captured = []

    async def fake_completion(**kwargs):
        captured.append(kwargs)
        return object()

    async def fake_stream(_value):
        return _response(tool_message)

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert len(captured) == 1
    assert "MUST call it" in captured[0]["messages"][0]["content"]
    assert captured[0]["tool_choice"] == "required"
    assert flow.state.messages[-1] == tool_message
    assert not any(message.get("role") == "tool" for message in flow.state.messages)


@pytest.mark.asyncio
async def test_multimodal_flow_preserves_converted_content_blocks(monkeypatch):
    from agents import multimodal_flow as module

    flow = module.MultimodalFlow()
    content = [
        {"type": "text", "text": "What is in this image?"},
        {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,AAAA"},
        },
    ]
    flow.state.messages = [{"role": "user", "content": content}]
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "An image."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    assert captured["messages"][-1]["content"] == content
    assert captured["model"] == "openai/gpt-5.4"


@pytest.mark.asyncio
async def test_multimodal_flow_sends_pdfs_as_responses_input_files(monkeypatch):
    from agents import multimodal_flow as module

    flow = module.MultimodalFlow()
    flow.state.messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this PDF?"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:application/pdf;base64,AAAA"},
                },
            ],
        }
    ]
    captured = {}

    async def fake_responses(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_completion(**_kwargs):
        raise AssertionError("PDF turns must not use Chat Completions")

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "A PDF."})

    monkeypatch.setattr(module, "aresponses", fake_responses)
    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    pdf_part = captured["input"][-1]["content"][-1]
    assert pdf_part == {
        "type": "input_file",
        "filename": "attachment.pdf",
        "file_data": "data:application/pdf;base64,AAAA",
    }
    assert captured["model"] == "openai/gpt-5.4"


@pytest.mark.asyncio
async def test_a2ui_recovery_runs_bridge_tool_and_persists_envelope(monkeypatch):
    from agents import a2ui_recovery_flow as module

    flow = module.A2UIRecoveryFlow()
    flow.state.messages = [
        {"role": "user", "content": "Build a self-healing dashboard."}
    ]
    outer_call = {
        "id": "call_generate_a2ui",
        "type": "function",
        "function": {"name": "generate_a2ui", "arguments": '{"intent":"create"}'},
    }
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [outer_call],
            }
        ),
        _response({"role": "assistant", "content": "Recovered."}),
    ]
    tool_runs = []
    tool_params = []
    completion_calls = []

    class FakeA2UITool:
        tool_name = "generate_a2ui"
        schema = {"type": "function", "function": {"name": "generate_a2ui"}}

        async def run(self, args, **kwargs):
            tool_runs.append((args, kwargs))
            return '{"a2ui_operations":[]}'

    async def fake_completion(**kwargs):
        completion_calls.append(kwargs)
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    def fake_get_a2ui_tools(params, **_kwargs):
        tool_params.append(params)
        return FakeA2UITool()

    monkeypatch.setattr(module, "get_a2ui_tools", fake_get_a2ui_tools)
    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.render()

    assert tool_params[0]["recovery"] == {"maxAttempts": 3}
    assert tool_runs[0][0] == {"intent": "create"}
    assert tool_runs[0][1]["tool_call_id"] == "call_generate_a2ui"
    assert completion_calls[1]["messages"][-2]["tool_calls"][0] == outer_call
    assert completion_calls[1]["messages"][-1]["role"] == "tool"
    assert flow.state.messages[-2]["content"] == '{"a2ui_operations":[]}'
    assert flow.state.messages[-1]["content"] == "Recovered."


@pytest.mark.asyncio
async def test_a2ui_recovery_drops_orphan_tool_results_from_model_context(
    monkeypatch,
):
    from agents import a2ui_recovery_flow as module

    flow = module.A2UIRecoveryFlow()
    flow.state.messages = [
        {"role": "user", "content": "Build the first dashboard."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "missing_parent_call",
                    "type": "function",
                    "function": {"name": "generate_a2ui", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "missing_parent_call",
            "content": '{"a2ui_operations":[]}',
        },
        {"role": "assistant", "content": "The first dashboard rendered."},
        {"role": "user", "content": "Now recover another dashboard."},
    ]
    captured = {}

    class FakeA2UITool:
        tool_name = "generate_a2ui"
        schema = {"type": "function", "function": {"name": "generate_a2ui"}}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "Ready."})

    monkeypatch.setattr(
        module, "get_a2ui_tools", lambda *_args, **_kwargs: FakeA2UITool()
    )
    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.render()

    assert not any(message.get("role") == "tool" for message in captured["messages"])
    assert not any(message.get("tool_calls") for message in captured["messages"])
    assert captured["messages"][-1]["content"] == "Now recover another dashboard."


@pytest.mark.asyncio
async def test_a2ui_fixed_flow_emits_backend_tool_result(monkeypatch):
    from agents import a2ui_fixed as module

    flow = module.A2UIFixedFlow()
    flow.state.messages = [{"role": "user", "content": "Find SFO to JFK."}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_display_flight",
                        "type": "function",
                        "function": {
                            "name": "display_flight",
                            "arguments": (
                                '{"origin":"SFO","destination":"JFK",'
                                '"airline":"United","price":"$289"}'
                            ),
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Flight rendered."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, json.loads(content)))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert emitted[0][0] == "call_display_flight"
    assert emitted[0][1]["a2ui_operations"]
    assert flow.state.messages[-1]["content"] == "Flight rendered."


@pytest.mark.asyncio
async def test_beautiful_chat_flow_emits_search_flights_a2ui_result(monkeypatch):
    from agents import beautiful_chat_flow as module

    flow = module.BeautifulChatFlow()
    flow.state.messages = [{"role": "user", "content": "Find flights."}]
    flight = {
        "airline": "United Airlines",
        "airlineLogo": "https://example.com/united.png",
        "flightNumber": "UA231",
        "origin": "SFO",
        "destination": "JFK",
        "date": "Tue, May 6",
        "departureTime": "08:00",
        "arrivalTime": "16:30",
        "duration": "5h 30m",
        "status": "On Time",
        "statusColor": "#22c55e",
        "price": "$349",
        "currency": "USD",
    }
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_search_flights",
                        "type": "function",
                        "function": {
                            "name": "search_flights",
                            "arguments": json.dumps({"flights": [flight]}),
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "One flight shown."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, json.loads(content)))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    await flow.chat()

    assert emitted[0][0] == "call_search_flights"
    assert emitted[0][1]["a2ui_operations"]
    assert flow.state.messages[-1]["content"] == "One flight shown."


@pytest.mark.asyncio
async def test_beautiful_chat_flow_keeps_event_loop_responsive_during_backend_tool(
    monkeypatch,
):
    from agents import beautiful_chat_flow as module

    flow = module.BeautifulChatFlow()
    flow.state.messages = [{"role": "user", "content": "Find flights."}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_blocking_tool",
                        "type": "function",
                        "function": {
                            "name": "search_flights",
                            "arguments": "{}",
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Done."}),
    ]

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit(_tool_call_id, _content, **_kwargs):
        return True

    def delayed_tool(**_kwargs):
        time.sleep(0.1)
        return "{}"

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)
    monkeypatch.setitem(
        module.BACKEND_TOOLS_BY_NAME,
        "search_flights",
        SimpleNamespace(_run=delayed_tool),
    )

    heartbeat = asyncio.create_task(asyncio.sleep(0.01))
    await flow.chat()
    heartbeat_ran_during_tool = heartbeat.done()
    await heartbeat

    assert heartbeat_ran_during_tool


@pytest.mark.asyncio
async def test_beautiful_chat_cancels_generate_a2ui_network_request(
    monkeypatch,
):
    from agents import beautiful_chat_flow as module
    import openai

    flow = module.BeautifulChatFlow()
    flow.state.messages = [{"role": "user", "content": "Build a dashboard."}]
    dispatch_started = asyncio.Event()
    async_started = asyncio.Event()
    async_cancelled = asyncio.Event()
    async_closed = asyncio.Event()
    sync_started = threading.Event()
    sync_release = threading.Event()
    sync_finished = threading.Event()
    event_loop = asyncio.get_running_loop()

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_generate_a2ui",
                        "type": "function",
                        "function": {
                            "name": "generate_a2ui",
                            "arguments": '{"context":"Show revenue"}',
                        },
                    }
                ],
            }
        )

    class FakeSyncCompletions:
        def create(self, **_kwargs):
            sync_started.set()
            event_loop.call_soon_threadsafe(dispatch_started.set)
            try:
                sync_release.wait(timeout=1)
                return _response(SimpleNamespace(tool_calls=[]))
            finally:
                sync_finished.set()

    class FakeSyncOpenAI:
        def __init__(self):
            self.chat = SimpleNamespace(completions=FakeSyncCompletions())

    class FakeAsyncCompletions:
        async def create(self, **_kwargs):
            async_started.set()
            dispatch_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                async_cancelled.set()
                raise

    class FakeAsyncOpenAI:
        def __init__(self):
            self.chat = SimpleNamespace(completions=FakeAsyncCompletions())

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            async_closed.set()

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(openai, "OpenAI", FakeSyncOpenAI)
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeAsyncOpenAI)

    task = asyncio.create_task(flow.chat())
    try:
        await asyncio.wait_for(dispatch_started.wait(), timeout=1)

        assert async_started.is_set()
        assert not sync_started.is_set()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=1)
        assert async_cancelled.is_set()
        assert async_closed.is_set()
    finally:
        sync_release.set()
        if not task.done():
            task.cancel()
            await asyncio.wait_for(
                asyncio.gather(task, return_exceptions=True),
                timeout=1,
            )
        if sync_started.is_set():
            sync_finished_observed = await asyncio.wait_for(
                asyncio.to_thread(sync_finished.wait, 1),
                timeout=2,
            )
            assert sync_finished_observed


@pytest.mark.asyncio
async def test_gen_ui_agent_closes_each_backend_step_tool_call(monkeypatch):
    from agents import gen_ui_agent as module

    flow = module.GenUiAgentFlow()
    flow.state.messages = [{"role": "user", "content": "Plan a launch."}]
    steps = [{"id": "one", "title": "Plan", "status": "pending"}]
    streamed = [
        _response(
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_steps",
                        "type": "function",
                        "function": {
                            "name": "set_steps",
                            "arguments": json.dumps({"steps": steps}),
                        },
                    }
                ],
            }
        ),
        _response({"role": "assistant", "content": "Plan ready."}),
    ]
    emitted = []

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_value):
        return streamed.pop(0)

    async def fake_emit_state(_state):
        return True

    async def fake_emit_result(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, content))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_state", fake_emit_state)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit_result)

    await flow.chat()

    assert emitted == [("call_steps", "Published 1 step(s).")]
    assert flow.state.messages[-1]["content"] == "Plan ready."


@pytest.mark.asyncio
async def test_gen_ui_agent_sends_only_the_active_user_turn(monkeypatch):
    from agents import gen_ui_agent as module

    flow = module.GenUiAgentFlow()
    flow.state.messages = [
        {"role": "user", "content": "Organize a team offsite."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_d5_set_steps_offsite_007",
                    "type": "function",
                    "function": {"name": "set_steps", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_d5_set_steps_offsite_007",
            "content": "Published 3 step(s).",
        },
        {
            "role": "assistant",
            "content": "Offsite locked in.",
        },
        {
            "role": "user",
            "content": "Research our top competitor and summarize weaknesses.",
        },
    ]
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_value):
        return _response({"role": "assistant", "content": "Starting research."})

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)

    await flow.chat()

    serialized = json.dumps(captured["messages"])
    assert "Research our top competitor" in serialized
    assert "call_d5_set_steps_offsite_007" not in serialized
    assert "Offsite locked in" not in serialized


def test_server_and_runtime_register_dedicated_flow_routes():
    server = AGENT_SERVER.read_text()
    route = MULTIMODAL_ROUTE.read_text()
    a2ui_route = A2UI_RECOVERY_ROUTE.read_text()
    open_gen_ui_route = OPEN_GEN_UI_RUNTIME_ROUTE.read_text()

    assert 'shared_state_read_flow, "/shared-state-read"' in server
    assert 'a2ui_fixed_flow, "/a2ui-fixed-schema"' in server
    assert 'beautiful_chat_flow, "/beautiful-chat"' in server
    assert 'shared_state_streaming_flow, "/shared-state-streaming"' in server
    assert 'multimodal_flow, "/multimodal"' in server
    assert 'a2ui_recovery_flow, "/a2ui-recovery"' in server
    assert 'tool_rendering_reasoning_flow, "/tool-rendering-reasoning"' in server
    assert "${AGENT_URL}/multimodal" in route
    assert "${AGENT_URL}/a2ui-recovery" in a2ui_route
    assert "injectA2UITool: false" in a2ui_route
    assert "`${AGENT_URL}/frontend-tools`" in open_gen_ui_route


def test_byoc_hashbrown_legacy_route_is_operational():
    page = INTEGRATION_ROOT / "src" / "app" / "demos" / "byoc-hashbrown" / "page.tsx"
    declarative_page = (
        INTEGRATION_ROOT
        / "src"
        / "app"
        / "demos"
        / "declarative-hashbrown"
        / "page.tsx"
    )

    assert page.exists()
    assert "declarative-hashbrown/page" in page.read_text()
    source = declarative_page.read_text()
    assert 'runtimeUrl="/api/copilotkit-byoc-hashbrown"' in source
    assert 'agent="byoc-hashbrown-demo"' in source
    assert 'data-testid="byoc-hashbrown-root"' in source


def test_multimodal_page_uses_native_attachment_conversion():
    page = MULTIMODAL_PAGE.read_text()

    assert "LegacyConverterShim" not in page
    assert "MultimodalChat" in page


def test_main_runtime_routes_specialized_agents_to_their_native_flows():
    route = MAIN_RUNTIME_ROUTE.read_text()
    mcp_apps_route = MCP_APPS_RUNTIME_ROUTE.read_text()

    expected_routes = {
        "shared-state-read": "/shared-state-read",
        "shared-state-write": "/shared-state-read-write",
        "shared-state-streaming": "/shared-state-streaming",
        "shared-state-read-write": "/shared-state-read-write",
        "subagents": "/subagents",
        "tool-rendering": "/tool-rendering",
        "tool-rendering-default-catchall": "/tool-rendering",
        "tool-rendering-custom-catchall": "/tool-rendering",
        "tool-rendering-reasoning-chain": "/tool-rendering-reasoning",
        "frontend_tools": "/frontend-tools",
        "frontend-tools-async": "/frontend-tools",
        "human_in_the_loop": "/frontend-tools",
        "hitl-in-chat": "/frontend-tools",
        "hitl-in-app": "/frontend-tools",
        "headless-complete": "/tool-rendering",
        "open-gen-ui": "/frontend-tools",
        "open-gen-ui-advanced": "/frontend-tools",
    }
    for agent_name, path in expected_routes.items():
        assert re.search(
            rf'agents\["{re.escape(agent_name)}"\]\s*=\s*createAgent\(\s*"{re.escape(path)}"',
            route,
        )
    assert "`${AGENT_URL}/tool-rendering`" in mcp_apps_route
