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
from research_desk.transport import prepare_express_input, transform_express_events


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


async def transformed(items):
    _, compiler = prepare_express_input(make_input())
    return [event async for event in transform_express_events(events(items), compiler)]


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
    _, compiler = prepare_express_input(make_input())
    first = text('```a2ui-express\nsurface("s")\nroot = Text("Hello")\n')
    second = text('root = Text("Goodbye")\n```')
    stream = transform_express_events(
        events([first, second, TextMessageEndEvent(message_id="m")]),
        compiler,
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


async def test_ordinary_code_fences_pass_through():
    source = 'Example:\n```python\nprint("hello")\n```\n'
    output = await transformed([text(source), TextMessageEndEvent(message_id="m")])
    assert (
        "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT") == source
    )


async def test_invalid_final_express_is_reported():
    with pytest.raises(ValueError):
        await transformed([text("```a2ui-express\nroot = MissingComponent()\n```")])


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
    assert '"later"' in content


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


def test_input_keeps_context_and_native_values_without_mutating_input():
    original = make_input()
    prepared, _ = prepare_express_input(original)
    assert prepared is not original
    assert prepared.context[0].value == "Use a calm tone."
    assert "OLD JSON GUIDE" not in "\n".join(c.value for c in prepared.context)
    assert original.context[1].value == "OLD JSON GUIDE"
    assert prepared.forwarded_props == original.forwarded_props
    assert "notes" in prepared.context[-1].value


async def test_end_of_stream_flushes_without_text_message_end():
    output = await transformed([text('```a2ui-express\nroot = Text("Ready")')])
    assert any(
        '"createSurface"' in e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT"
    )


@pytest.mark.parametrize(
    "source",
    [
        '```a2ui-express\nroot = Text("truncated',
        "```a2ui-express target=notes",
        '```a2ui-express\nleaf = Text("missing root")',
    ],
)
async def test_end_of_stream_rejects_incomplete_program(source):
    with pytest.raises(ValueError):
        await transformed([text(source)])


@pytest.mark.parametrize("source", ["", 'surface("s")', "# No root"])
async def test_final_empty_surface_program_is_not_success(source):
    with pytest.raises(ValueError):
        await transformed([text("```a2ui-express\n" + source + "\n```")])


async def test_invalid_final_flush_precedes_run_finished_and_closes_source():
    from ag_ui.core import RunFinishedEvent

    closed = False

    async def upstream():
        nonlocal closed
        try:
            yield text('```a2ui-express\nroot = Text("truncated')
            yield RunFinishedEvent(thread_id="thread", run_id="run")
        finally:
            closed = True

    _, compiler = prepare_express_input(make_input())
    emitted = []
    with pytest.raises(ValueError):
        async for event in transform_express_events(upstream(), compiler):
            emitted.append(event)
    assert closed
    assert not any(event.type == "RUN_FINISHED" for event in emitted)


async def test_research_state_and_tool_events_pass_unchanged():
    from ag_ui.core import CustomEvent, StateSnapshotEvent

    items = [
        CustomEvent(name="research", value={"query": "climate"}),
        StateSnapshotEvent(snapshot={"sources": [{"url": "https://example.com"}]}),
        ToolCallStartEvent(tool_call_id="research-1", tool_call_name="research"),
        ToolCallArgsEvent(tool_call_id="research-1", delta='{"query":"climate"}'),
        ToolCallEndEvent(tool_call_id="research-1"),
    ]
    output = await transformed(items)
    assert output == items
    assert all(actual is original for actual, original in zip(output, items))


def test_request_compilers_keep_surface_state_separate():
    first = make_input()
    first.forwarded_props["copilotkit"]["ui"]["metadata"]["extensions"][
        "copilotkit_surfaces"
    ] = {
        "previous": {
            "target": "notes",
            "dataModel": {"/choice": "user-edited"},
            "rejected": ["bad child"],
        }
    }
    prepared, compiler = prepare_express_input(first)
    _, other = prepare_express_input(make_input())
    assert compiler is not other
    assert "user-edited" in prepared.context[-1].value
    assert "bad child" in prepared.context[-1].value
    assert other.demo_surfaces == {}


@pytest.mark.parametrize(
    "source", ['```python  \nprint("x")\n```\n', "```python\r\npass\r\n```\r\n"]
)
async def test_other_code_fences_preserve_exact_text(source):
    output = await transformed([text(source), TextMessageEndEvent(message_id="m")])
    assert (
        "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT") == source
    )


@pytest.mark.parametrize("size", [1, 7, 99])
async def test_tab_separated_express_header_compiles_without_leaking_source(size):
    source = '```a2ui-express\ttarget=notes\nroot = Text("Ready")\n```'
    output = await transformed(
        [
            *[text(source[i : i + size]) for i in range(0, len(source), size)],
            TextMessageEndEvent(message_id="m"),
        ]
    )
    content = "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT")
    assert "```a2ui target=notes" in content
    assert '"createSurface"' in content
    assert "a2ui-express" not in content
    assert "root = " not in content


@pytest.mark.parametrize("size", [1, 7, 99])
async def test_crlf_express_fences_compile_across_chunk_boundaries(size):
    source = (
        "Before.\r\n```a2ui-express target=notes\r\n"
        'root = Text("Ready")\r\n```\r\nAfter.'
    )
    output = await transformed(
        [
            *[text(source[i : i + size]) for i in range(0, len(source), size)],
            TextMessageEndEvent(message_id="m"),
        ]
    )
    content = "".join(e.delta for e in output if e.type == "TEXT_MESSAGE_CONTENT")
    assert content.startswith("Before.\r\n")
    assert content.endswith("After.")
    assert "```a2ui target=notes" in content
    assert content.count('"createSurface"') == 1
    assert "a2ui-express" not in content
    assert "root = " not in content


@pytest.mark.parametrize("trailing_events", [False, True])
async def test_provider_error_discards_truncated_express_and_closes_source(
    trailing_events,
):
    from ag_ui.core import RunErrorEvent

    provider_error = RunErrorEvent(message="Provider failed", code="PROVIDER_ERROR")
    closed = False
    continued_after_error = False

    async def upstream():
        nonlocal closed, continued_after_error
        try:
            yield text('```a2ui-express\nroot = Text("truncated')
            yield provider_error
            if trailing_events:
                continued_after_error = True
                yield text('")\n```\nLate content')
                yield TextMessageEndEvent(message_id="m")
        finally:
            closed = True

    _, compiler = prepare_express_input(make_input())
    emitted = [event async for event in transform_express_events(upstream(), compiler)]
    assert emitted == [provider_error]
    assert emitted[0] is provider_error
    assert closed
    assert not continued_after_error
