import json
import re

import pytest
from ag_ui.core import (
    Context,
    RunAgentInput,
    TextMessageContentEvent,
    TextMessageEndEvent,
    Tool,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)

from src.transport import prepare_express_input, transform_express_events


def envelope():
    return {
        "v1.0": {
            "supportedCatalogIds": ["demo"],
            "inlineCatalogs": [
                {
                    "catalogId": "demo",
                    "protocolVersion": "1.0",
                    "components": {
                        "Text": {
                            "props": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                },
                                "required": ["text"],
                            }
                        }
                    },
                    "functions": {},
                }
            ],
        },
        "metadata": {
            "extensions": {
                "copilotkit_targets": [
                    {"id": "chat", "kind": "chat"},
                    {"id": "notes", "kind": "inline"},
                ],
                "copilotkit_surfaces": [],
            }
        },
    }


def make_input():
    return RunAgentInput(
        thread_id="thread",
        run_id="run",
        state={},
        messages=[],
        tools=[
            Tool(name="render_ui", description="JSON UI", parameters={"type": "object"})
        ],
        context=[
            Context(description="User preferences", value="Use a calm tone."),
            Context(
                description="Generative UI guide: available components, functions, targets, and how to call render_ui.",
                value="OLD JSON GUIDE",
            ),
        ],
        forwarded_props={"copilotkit": {"ui": envelope()}},
    )


async def events(items):
    for item in items:
        yield item


async def transformed(items, transport="markdown"):
    _, compiler = prepare_express_input(make_input(), transport)
    return [
        event
        async for event in transform_express_events(events(items), compiler, transport)
    ]


def text(delta):
    return TextMessageContentEvent(message_id="m", delta=delta)


@pytest.mark.parametrize("size", [1, 2, 7, 99])
async def test_fences_split_at_any_character_preserve_prose_and_hide_express(size):
    source = 'Before.\n```a2ui-express target=notes\nsurface("s")\nroot = Text("Hello")\n```\nAfter.'
    output = await transformed(
        [
            *[text(source[i : i + size]) for i in range(0, len(source), size)],
            TextMessageEndEvent(message_id="m"),
        ]
    )
    content = "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT")
    assert content.startswith("Before.")
    assert content.endswith("After.")
    assert "target=notes" in content
    assert '"createSurface"' in content
    assert "root = " not in content
    assert "a2ui-express" not in content


async def test_renders_before_fence_closes_and_does_not_recreate_surface():
    _, compiler = prepare_express_input(make_input(), "markdown")
    first = text('```a2ui-express\nsurface("s")\nroot = Text("Hello")\n')
    second = text('root = Text("Goodbye")\n```')
    stream = transform_express_events(
        events([first, second, TextMessageEndEvent(message_id="m")]),
        compiler,
        "markdown",
    )
    early = await anext(stream)
    assert "Hello" in early.delta
    rest = [event async for event in stream]
    content = early.delta + "".join(
        e.delta for e in rest if e.type == "TEXT_MESSAGE_CONTENT"
    )
    assert content.count('"createSurface"') == 1
    assert '"updateComponents"' in content
    assert "Goodbye" in content


async def test_tool_is_real_call_with_preserved_id_and_compiled_arguments():
    raw = json.dumps(
        {"target": "notes", "source": 'surface("s")\nroot = Text("Hello")'}
    )
    output = await transformed(
        [
            ToolCallStartEvent(tool_call_id="real-id", tool_call_name="render_ui"),
            ToolCallArgsEvent(tool_call_id="real-id", delta=raw[:15]),
            ToolCallArgsEvent(tool_call_id="real-id", delta=raw[15:]),
            ToolCallEndEvent(tool_call_id="real-id"),
        ],
        "tool",
    )
    assert [e.type for e in output] == [
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
    ]
    assert all(e.tool_call_id == "real-id" for e in output)
    args = json.loads(output[1].delta)
    assert args["target"] == "notes"
    assert args["operations"][0]["version"] == "v1.0"
    assert "source" not in args


async def test_ordinary_code_fences_pass_through():
    source = 'Example:\n```python\nprint("hello")\n```\n'
    output = await transformed([text(source), TextMessageEndEvent(message_id="m")])
    assert (
        "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT") == source
    )


async def test_invalid_final_express_is_reported():
    with pytest.raises(ValueError):
        await transformed([text("```a2ui-express\nroot = MissingComponent()\n```")])


def test_input_keeps_app_context_and_replaces_json_guide_and_tool_schema():
    original = make_input()
    prepared, _ = prepare_express_input(original, "tool")
    assert prepared.context[0].value == "Use a calm tone."
    assert "OLD JSON GUIDE" not in "\n".join(c.value for c in prepared.context)
    assert "source" in prepared.tools[0].parameters["properties"]
    assert "source" not in original.tools[0].parameters.get("properties", {})
    assert "notes" in prepared.context[-1].value


async def test_invalid_tool_source_returns_actionable_result():
    output = await transformed(
        [
            ToolCallStartEvent(tool_call_id="bad", tool_call_name="render_ui"),
            ToolCallArgsEvent(
                tool_call_id="bad",
                delta=json.dumps(
                    {"target": "chat", "source": "root = MissingComponent()"}
                ),
            ),
            ToolCallEndEvent(tool_call_id="bad"),
        ],
        "tool",
    )
    result = next(e for e in output if e.type == "TOOL_CALL_RESULT")
    assert json.loads(result.content)["status"] == "error"
    assert "MissingComponent" in result.content


async def test_delete_is_not_replayed_on_every_partial_snapshot():
    output = await transformed(
        [
            text(
                '```a2ui-express\ndeleteSurface("s")\nsurface("s")\nroot = Text("new")\n'
            ),
            text('next = Text("later")\n'),
            text("```"),
            TextMessageEndEvent(message_id="m"),
        ]
    )
    content = "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT")
    assert content.count('"deleteSurface"') == 1
    assert content.count('"createSurface"') == 1
    assert '"updateComponents"' in content


async def test_backticks_in_express_string_are_not_a_fence_at_chunk_start():
    chunks = ['```a2ui-express\nroot = Text("', "```", '")\n```\n']
    output = await transformed(
        [*[text(c) for c in chunks], TextMessageEndEvent(message_id="m")]
    )
    content = "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT")
    assert '"text": "```"' in content
    assert content.count('"createSurface"') == 1


async def test_truncated_express_header_does_not_leak_into_chat():
    with pytest.raises(ValueError, match="header"):
        await transformed(
            [text("```a2ui-express target=notes"), TextMessageEndEvent(message_id="m")]
        )


@pytest.mark.parametrize("size", [1, 7, 99])
async def test_root_last_stream_never_updates_an_unknown_surface(size):
    source = (
        '```a2ui-express target=notes\nsurface("s")\n'
        '$/label = "Hello"\nlabel = Text(text=$/label)\n'
        'root = Text(text="Ready")\n```'
    )
    output = await transformed(
        [
            *[text(source[i : i + size]) for i in range(0, len(source), size)],
            TextMessageEndEvent(message_id="m"),
        ]
    )
    content = "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT")
    operations = [
        operation
        for body in re.findall(r"```a2ui target=notes\n(.*?)\n```", content, re.DOTALL)
        for operation in json.loads(body)
    ]
    assert operations
    created = set()
    for operation in operations:
        if "createSurface" in operation:
            created.add(operation["createSurface"]["surfaceId"])
        for kind in ("updateComponents", "updateDataModel"):
            if kind in operation:
                assert operation[kind]["surfaceId"] in created
    assert operations[0]["createSurface"]["dataModel"] == {"label": "Hello"}
